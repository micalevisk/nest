import {
  BadRequestException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  type RequestMethod,
  StreamableFile,
  VERSION_NEUTRAL,
  type VersioningOptions,
  VersioningType,
} from '@nestjs/common';
import cors from 'cors';
import express from 'express';
import type { Server } from 'http';
import * as http from 'http';
import * as https from 'https';
import { pathToRegexp } from 'path-to-regexp';
import { Duplex, Writable } from 'stream';
import {
  NestExpressBodyParserOptionsFor,
  NestExpressBodyParserType,
} from '../interfaces/nest-express-body-parser.interface.js';
import { ServeStaticOptions } from '../interfaces/serve-static-options.interface.js';
import { getBodyParserOptions } from './utils/get-body-parser-options.util.js';
import {
  type CorsOptions,
  type CorsOptionsDelegate,
  type RequestHandler,
  type VersionValue,
  isFunction,
  isNil,
  isObject,
  isString,
  isUndefined,
} from '@nestjs/common/internal';
import type { NestApplicationOptions } from '@nestjs/common';
import { AbstractHttpAdapter } from '@nestjs/core';
import {
  RouterMethodFactory,
  LegacyRouteConverter,
} from '@nestjs/core/internal';

type VersionedRoute = <
  TRequest extends Record<string, any> = any,
  TResponse = any,
>(
  req: TRequest,
  res: TResponse,
  next: () => void,
) => any;

/**
 * `express.Application['get']` is typed as `((name: string) => any) &
 * express.IRouterMatcher<this>` (the settings-getter overload intersected
 * with the route-matcher overload), and `getRouteTarget()` returns
 * `express.Application | express.Router`. Spreading a handlers array into a
 * call on that union — even a well-typed `(path, ...handlers)` tuple —
 * cannot be resolved by TypeScript, because each union member's `get`
 * resolves to a different (intersected vs. plain) generic overload. This
 * type describes only the verb-matcher shape every route-registration
 * method here actually uses, so each call has a single, non-unioned
 * generic overload to resolve against.
 */
type ExpressRouteMatcherTarget = {
  [Verb in
    | 'get'
    | 'post'
    | 'put'
    | 'delete'
    | 'patch'
    | 'all'
    | 'options'
    | 'head'
    | 'search'
    | 'query'
    | 'propfind'
    | 'proppatch'
    | 'mkcol'
    | 'copy'
    | 'move'
    | 'lock'
    | 'unlock']: express.IRouterMatcher<any>;
};

/**
 * @publicApi
 */
export class ExpressAdapter extends AbstractHttpAdapter<
  http.Server | https.Server
> {
  private readonly routerMethodFactory = new RouterMethodFactory();
  private readonly logger = new Logger(ExpressAdapter.name);
  private readonly openConnections = new Set<Duplex>();
  private readonly registeredPrefixes = new Set<string>();
  private lateRouter?: express.Router;
  private isShuttingDown = false;
  private onRequestHook?: (
    req: express.Request,
    res: express.Response,
    done: () => void,
  ) => Promise<void> | void;
  private onResponseHook?: (
    req: express.Request,
    res: express.Response,
  ) => Promise<void> | void;

  constructor(instance?: any) {
    super(instance || express());
    this.instance!.use((req, res, next) => {
      if (this.onResponseHook) {
        res.on('finish', () => {
          void this.onResponseHook!.apply(this, [req, res]);
        });
      }

      if (this.onRequestHook) {
        void this.onRequestHook.apply(this, [req, res, next]);
      } else {
        next();
      }
    });
  }

  public setOnRequestHook(
    onRequestHook: (
      req: express.Request,
      res: express.Response,
      done: () => void,
    ) => Promise<void> | void,
  ) {
    this.onRequestHook = onRequestHook;
  }

  public setOnResponseHook(
    onResponseHook: (
      req: express.Request,
      res: express.Response,
    ) => Promise<void> | void,
  ) {
    this.onResponseHook = onResponseHook;
  }

  public reply(response: any, body: any, statusCode?: number) {
    if (!isNil(statusCode)) {
      response.status(statusCode);
    }
    if (isNil(body)) {
      return response.send();
    }
    if (body instanceof StreamableFile) {
      this.applyStreamHeaders(response, body);
      const stream = body.getStream();
      stream.once('error', err => {
        body.errorHandler(err, response);
      });
      return stream
        .pipe<Writable>(response)
        .on('error', (err: Error) => body.errorLogger(err));
    }
    const responseContentType = response.getHeader('Content-Type');
    if (
      typeof responseContentType === 'string' &&
      !responseContentType.startsWith('application/json') &&
      body?.statusCode >= HttpStatus.BAD_REQUEST
    ) {
      this.logger.warn(
        "Content-Type doesn't match Reply body, you might need a custom ExceptionFilter for non-JSON responses",
      );
      response.setHeader('Content-Type', 'application/json');
    }
    return isObject(body) ? response.json(body) : response.send(String(body));
  }

  public status(response: any, statusCode: number) {
    return response.status(statusCode);
  }

  public end(response: any, message?: string) {
    return response.end(message);
  }

  public render(response: any, view: string, options: any) {
    return response.render(view, options);
  }

  public redirect(response: any, statusCode: number, url: string) {
    return response.redirect(statusCode, url);
  }

  public setErrorHandler(handler: Function, prefix?: string) {
    if (prefix) {
      const router = express.Router();
      router.use(handler as any);
      this.use(prefix, router);
    }
    // Always mount the error handler at the root as well, so routes living
    // outside the global prefix (e.g. "setGlobalPrefix" exclusions or
    // root-mounted routes) still pass through the exception layer.
    return this.use(handler);
  }

  public setNotFoundHandler(handler: Function, prefix?: string) {
    this.mountLateRouter();
    if (prefix) {
      this.registeredPrefixes.add(prefix);
      const router = express.Router();
      router.all('*path', handler as any);
      return this.use(prefix, router);
    }
    return this.use(
      (
        req: express.Request,
        res: express.Response,
        next: express.NextFunction,
      ) => {
        // When multiple apps share this adapter, a non-prefixed app's 404
        // handler may be registered before a prefixed app's routes. Skip
        // requests whose path belongs to another app's prefix so they can
        // reach the correct route handlers further in the stack.
        const path = req.originalUrl.split(/[?#]/)[0];
        for (const registeredPrefix of this.registeredPrefixes) {
          // Match on full path segments only, so a prefix of "/api" does not
          // swallow unrelated paths such as "/apiary".
          if (
            path === registeredPrefix ||
            path.startsWith(`${registeredPrefix}/`)
          ) {
            return next();
          }
        }
        return (handler as any)(req, res, next);
      },
    );
  }

  public get(handler: RequestHandler);
  public get(path: any, handler: RequestHandler);
  public get(...args: any[]) {
    // `app.get(name)` with a single string reads an application setting.
    if (args.length === 1 && typeof args[0] === 'string') {
      return this.instance.get(args[0]);
    }
    const [path, ...handlers] = args;
    return this.getRouteTarget().get(path, ...handlers);
  }

  public post(handler: RequestHandler);
  public post(path: any, handler: RequestHandler);
  public post(...args: any[]) {
    const [path, ...handlers] = args;
    return this.getRouteTarget().post(path, ...handlers);
  }

  public put(handler: RequestHandler);
  public put(path: any, handler: RequestHandler);
  public put(...args: any[]) {
    const [path, ...handlers] = args;
    return this.getRouteTarget().put(path, ...handlers);
  }

  public delete(handler: RequestHandler);
  public delete(path: any, handler: RequestHandler);
  public delete(...args: any[]) {
    const [path, ...handlers] = args;
    return this.getRouteTarget().delete(path, ...handlers);
  }

  public patch(handler: RequestHandler);
  public patch(path: any, handler: RequestHandler);
  public patch(...args: any[]) {
    const [path, ...handlers] = args;
    return this.getRouteTarget().patch(path, ...handlers);
  }

  public all(handler: RequestHandler);
  public all(path: any, handler: RequestHandler);
  public all(...args: any[]) {
    const [path, ...handlers] = args;
    return this.getRouteTarget().all(path, ...handlers);
  }

  public options(handler: RequestHandler);
  public options(path: any, handler: RequestHandler);
  public options(...args: any[]) {
    const [path, ...handlers] = args;
    return this.getRouteTarget().options(path, ...handlers);
  }

  public head(handler: RequestHandler);
  public head(path: any, handler: RequestHandler);
  public head(...args: any[]) {
    const [path, ...handlers] = args;
    return this.getRouteTarget().head(path, ...handlers);
  }

  public search(handler: RequestHandler);
  public search(path: any, handler: RequestHandler);
  public search(...args: any[]) {
    const [path, ...handlers] = args;
    return this.getRouteTarget().search(path, ...handlers);
  }

  public query(handler: RequestHandler);
  public query(path: any, handler: RequestHandler);
  public query(...args: any[]) {
    const [path, ...handlers] = args;
    return this.getRouteTarget().query(path, ...handlers);
  }

  public propfind(handler: RequestHandler);
  public propfind(path: any, handler: RequestHandler);
  public propfind(...args: any[]) {
    const [path, ...handlers] = args;
    return this.getRouteTarget().propfind(path, ...handlers);
  }

  public proppatch(handler: RequestHandler);
  public proppatch(path: any, handler: RequestHandler);
  public proppatch(...args: any[]) {
    const [path, ...handlers] = args;
    return this.getRouteTarget().proppatch(path, ...handlers);
  }

  public mkcol(handler: RequestHandler);
  public mkcol(path: any, handler: RequestHandler);
  public mkcol(...args: any[]) {
    const [path, ...handlers] = args;
    return this.getRouteTarget().mkcol(path, ...handlers);
  }

  public copy(handler: RequestHandler);
  public copy(path: any, handler: RequestHandler);
  public copy(...args: any[]) {
    const [path, ...handlers] = args;
    return this.getRouteTarget().copy(path, ...handlers);
  }

  public move(handler: RequestHandler);
  public move(path: any, handler: RequestHandler);
  public move(...args: any[]) {
    const [path, ...handlers] = args;
    return this.getRouteTarget().move(path, ...handlers);
  }

  public lock(handler: RequestHandler);
  public lock(path: any, handler: RequestHandler);
  public lock(...args: any[]) {
    const [path, ...handlers] = args;
    return this.getRouteTarget().lock(path, ...handlers);
  }

  public unlock(handler: RequestHandler);
  public unlock(path: any, handler: RequestHandler);
  public unlock(...args: any[]) {
    const [path, ...handlers] = args;
    return this.getRouteTarget().unlock(path, ...handlers);
  }

  public isHeadersSent(response: any): boolean {
    return response.headersSent;
  }

  public getHeader(response: any, name: string) {
    return response.get(name);
  }

  public setHeader(response: any, name: string, value: string) {
    return response.set(name, value);
  }

  public appendHeader(response: any, name: string, value: string) {
    return response.append(name, value);
  }

  public normalizePath(path: string): string {
    try {
      const convertedPath = LegacyRouteConverter.tryConvert(path);
      // Call "pathToRegexp" to trigger a TypeError if the path is invalid
      pathToRegexp(convertedPath);
      return convertedPath;
    } catch (e) {
      if (e instanceof TypeError) {
        LegacyRouteConverter.printError(path);
      }
      throw e;
    }
  }

  public listen(port: string | number, callback?: () => void): Server;
  public listen(
    port: string | number,
    hostname: string,
    callback?: () => void,
  ): Server;
  public listen(port: any, ...args: any[]): Server {
    return this.httpServer.listen(port, ...args);
  }

  public beforeClose() {
    this.isShuttingDown = true;
  }

  public close() {
    this.isShuttingDown = true;
    this.closeOpenConnections();

    if (!this.httpServer) {
      return undefined;
    }
    return new Promise(resolve => this.httpServer.close(resolve));
  }

  public set(...args: any[]) {
    return this.instance.set(...args);
  }

  public enable(...args: any[]) {
    return this.instance.enable(...args);
  }

  public disable(...args: any[]) {
    return this.instance.disable(...args);
  }

  public engine(...args: any[]) {
    return this.instance.engine(...args);
  }

  public useStaticAssets(path: string, options: ServeStaticOptions) {
    if (options && options.prefix) {
      return this.use(options.prefix, express.static(path, options));
    }
    return this.use(express.static(path, options));
  }

  public setBaseViewsDir(path: string | string[]) {
    return this.set('views', path);
  }

  public setViewEngine(engine: string) {
    return this.set('view engine', engine);
  }

  public getRequestHostname(request: any): string {
    return request.hostname;
  }

  public getRequestMethod(request: any): string {
    return request.method;
  }

  public getRequestUrl(request: any): string {
    return request.originalUrl;
  }

  public enableCors(options: CorsOptions | CorsOptionsDelegate<any>) {
    return this.use(cors(options as any));
  }

  public createMiddlewareFactory(
    requestMethod: RequestMethod,
  ): (path: string, callback: Function) => any {
    return (path: string, callback: Function) => {
      try {
        const convertedPath = LegacyRouteConverter.tryConvert(path);
        return this.routerMethodFactory
          .get(this.instance, requestMethod)
          .call(this.instance, convertedPath, callback);
      } catch (e) {
        if (e instanceof TypeError) {
          LegacyRouteConverter.printError(path);
        }
        throw e;
      }
    };
  }

  public initHttpServer(options: NestApplicationOptions) {
    const isHttpsEnabled = options && options.httpsOptions;
    if (isHttpsEnabled) {
      this.httpServer = https.createServer(
        options.httpsOptions!,
        this.getInstance(),
      );
    } else {
      this.httpServer = http.createServer(this.getInstance());
    }

    if (options?.return503OnClosing) {
      this.instance.use((req: any, res: any, next: any) => {
        if (this.isShuttingDown) {
          res.set('Connection', 'close');
          res.status(503).send('Service Unavailable');
        } else {
          next();
        }
      });
    }

    if (options?.forceCloseConnections) {
      this.trackOpenConnections();
    }
  }

  public registerParserMiddleware(prefix?: string, rawBody?: boolean) {
    const bodyParserJsonOptions = getBodyParserOptions('json', rawBody!);
    const bodyParserUrlencodedOptions = getBodyParserOptions(
      'urlencoded',
      rawBody!,
      { extended: true },
    );

    const parserMiddleware = {
      jsonParser: express.json(bodyParserJsonOptions),
      urlencodedParser: express.urlencoded(bodyParserUrlencodedOptions),
    };
    Object.keys(parserMiddleware)
      .filter(parser => !this.isMiddlewareApplied(parser))
      .forEach(parserKey => this.use(parserMiddleware[parserKey]));
  }

  public useBodyParser<ParserType extends NestExpressBodyParserType>(
    type: ParserType,
    rawBody: boolean,
    options?: NestExpressBodyParserOptionsFor<ParserType>,
  ): this {
    const parserOptions = getBodyParserOptions(type, rawBody, options);
    const parser = express[type](parserOptions);

    this.use(parser);

    return this;
  }

  public setLocal(key: string, value: any) {
    this.instance.locals[key] = value;
    return this;
  }

  public getType(): string {
    return 'express';
  }

  public isRouteOrderSensitive(): boolean {
    return true;
  }

  public applyVersionFilter(
    handler: Function,
    version: VersionValue,
    versioningOptions: VersioningOptions,
  ): VersionedRoute {
    const callNextHandler: VersionedRoute = (req, res, next) => {
      if (!next) {
        throw new InternalServerErrorException(
          'HTTP adapter does not support filtering on version',
        );
      }
      return next();
    };

    if (
      version === VERSION_NEUTRAL ||
      // URL Versioning is done via the path, so the filter continues forward
      versioningOptions.type === VersioningType.URI
    ) {
      const handlerForNoVersioning: VersionedRoute = (req, res, next) =>
        handler(req, res, next);

      return handlerForNoVersioning;
    }

    // Custom Extractor Versioning Handler
    if (versioningOptions.type === VersioningType.CUSTOM) {
      const handlerForCustomVersioning: VersionedRoute = (req, res, next) => {
        const extractedVersion = versioningOptions.extractor(req);

        if (Array.isArray(version)) {
          if (
            Array.isArray(extractedVersion) &&
            version.filter(v => extractedVersion.includes(v as string)).length
          ) {
            return handler(req, res, next);
          }

          if (
            isString(extractedVersion) &&
            version.includes(extractedVersion)
          ) {
            return handler(req, res, next);
          }
        } else if (isString(version)) {
          // Known bug here - if there are multiple versions supported across separate
          // handlers/controllers, we can't select the highest matching handler.
          // Since this code is evaluated per-handler, then we can't see if the highest
          // specified version exists in a different handler.
          if (
            Array.isArray(extractedVersion) &&
            extractedVersion.includes(version)
          ) {
            return handler(req, res, next);
          }

          if (isString(extractedVersion) && version === extractedVersion) {
            return handler(req, res, next);
          }
        }

        return callNextHandler(req, res, next);
      };

      return handlerForCustomVersioning;
    }

    // Media Type (Accept Header) Versioning Handler
    if (versioningOptions.type === VersioningType.MEDIA_TYPE) {
      const handlerForMediaTypeVersioning: VersionedRoute = (
        req,
        res,
        next,
      ) => {
        const MEDIA_TYPE_HEADER = 'Accept';
        const acceptHeaderValue: string | undefined =
          req.headers?.[MEDIA_TYPE_HEADER] ||
          req.headers?.[MEDIA_TYPE_HEADER.toLowerCase()];

        const acceptHeaderVersionParameter = acceptHeaderValue
          ? acceptHeaderValue.split(';')[1]
          : undefined;

        // No version was supplied
        if (isUndefined(acceptHeaderVersionParameter)) {
          if (Array.isArray(version)) {
            if (version.includes(VERSION_NEUTRAL)) {
              return handler(req, res, next);
            }
          }
        } else {
          const headerVersion = acceptHeaderVersionParameter.split(
            versioningOptions.key,
          )[1];

          if (Array.isArray(version)) {
            if (version.includes(headerVersion)) {
              return handler(req, res, next);
            }
          } else if (isString(version)) {
            if (version === headerVersion) {
              return handler(req, res, next);
            }
          }
        }

        return callNextHandler(req, res, next);
      };

      return handlerForMediaTypeVersioning;
    }

    // Header Versioning Handler
    if (versioningOptions.type === VersioningType.HEADER) {
      const handlerForHeaderVersioning: VersionedRoute = (req, res, next) => {
        const customHeaderVersionParameter: string | undefined =
          req.headers?.[versioningOptions.header] ||
          req.headers?.[versioningOptions.header.toLowerCase()];

        // No version was supplied
        if (isUndefined(customHeaderVersionParameter)) {
          if (Array.isArray(version)) {
            if (version.includes(VERSION_NEUTRAL)) {
              return handler(req, res, next);
            }
          }
        } else {
          if (Array.isArray(version)) {
            if (version.includes(customHeaderVersionParameter)) {
              return handler(req, res, next);
            }
          } else if (isString(version)) {
            if (version === customHeaderVersionParameter) {
              return handler(req, res, next);
            }
          }
        }

        return callNextHandler(req, res, next);
      };

      return handlerForHeaderVersioning;
    }

    throw new Error('Unsupported versioning options');
  }

  public mapException(error: unknown): unknown {
    switch (true) {
      // SyntaxError is thrown by Express body-parser when given invalid JSON (#422, #430)
      // URIError is thrown by Express when given a path parameter with an invalid percentage
      // encoding, e.g. '%FF' (#8915)
      case error instanceof SyntaxError || error instanceof URIError:
        return new BadRequestException(error.message);
      default:
        return error;
    }
  }

  /**
   * Express matches layers in registration order, so a route added after
   * the not-found layer would never be reached. Mount an anchor router
   * once, right before the first not-found layer; every verb registered
   * afterwards (e.g. via RouterService after bootstrap) goes through it.
   */
  private mountLateRouter() {
    if (this.lateRouter) {
      return;
    }
    this.lateRouter = express.Router({
      caseSensitive: this.instance.enabled('case sensitive routing'),
      strict: this.instance.enabled('strict routing'),
    });
    this.instance.use(this.lateRouter);
  }

  private getRouteTarget(): ExpressRouteMatcherTarget {
    // The underlying object is still a real express.Application or
    // express.Router at runtime; see the `ExpressRouteMatcherTarget`
    // comment for why it's described with this narrower, per-verb type
    // rather than `express.Application | express.Router`.
    return (this.lateRouter ??
      this.instance) as unknown as ExpressRouteMatcherTarget;
  }

  private trackOpenConnections() {
    this.httpServer.on('connection', (socket: Duplex) => {
      this.openConnections.add(socket);

      socket.on('close', () => this.openConnections.delete(socket));
    });
  }

  private closeOpenConnections() {
    for (const socket of this.openConnections) {
      socket.destroy();
      this.openConnections.delete(socket);
    }
  }

  private isMiddlewareApplied(name: string): boolean {
    const app = this.getInstance();
    return (
      !!app.router &&
      !!app.router.stack &&
      isFunction(app.router.stack.filter) &&
      app.router.stack.some(
        (layer: any) => layer && layer.handle && layer.handle.name === name,
      )
    );
  }

  private setHeaderIfNotExists(
    response: any,
    name: string,
    value?: string | string[] | number,
  ) {
    if (value !== undefined && response.getHeader(name) === undefined) {
      const headerValue = Array.isArray(value) ? value.join(',') : value;
      response.setHeader(name, headerValue);
    }
  }

  private applyStreamHeaders(response: any, streamable: StreamableFile) {
    const headers = streamable.getHeaders();

    this.setHeaderIfNotExists(response, 'Content-Type', headers.type);
    this.setHeaderIfNotExists(
      response,
      'Content-Disposition',
      headers.disposition,
    );
    this.setHeaderIfNotExists(response, 'Content-Length', headers.length);
  }
}
