import { RequestMethod } from '../../enums/index.js';
import { NestApplicationOptions } from '../../interfaces/nest-application-options.interface.js';
import {
  VersionValue,
  VersioningOptions,
} from '../version-options.interface.js';

/**
 * Shape of the error-layer callback that Nest hands to
 * {@link HttpServer.setErrorHandler}.
 *
 * The adapter must invoke it whenever a route handler or middleware
 * registered through the adapter fails, passing the thrown value first.
 * `next` may be omitted when the underlying framework has no notion of an
 * error-continuation callback.
 *
 * @publicApi
 */
export type ErrorHandler<TRequest = any, TResponse = any> = (
  error: any,
  req: TRequest,
  res: TResponse,
  next?: Function,
) => any;

/**
 * Shape of every callback Nest registers through the adapter: route handlers,
 * middleware, and the not-found handler.
 *
 * Nest always invokes these with three arguments. Adapters must forward a
 * working `next` because the host filter (`@Controller({ host })`) and the
 * version filter call it to skip a non-matching handler, and throw
 * `InternalServerErrorException` when it is missing.
 *
 * @publicApi
 */
export type RequestHandler<TRequest = any, TResponse = any> = (
  req: TRequest,
  res: TResponse,
  next?: Function,
) => any;

/**
 * Contract between the Nest core (`NestApplication`, the router, the
 * middleware module and the exception layer) and an HTTP platform such as
 * Express or Fastify.
 *
 * Implementations normally extend `AbstractHttpAdapter` from `@nestjs/core`,
 * which supplies defaults for the methods that can simply delegate to the
 * underlying framework instance. This interface is the source of truth for
 * *when* the core calls each method and *what* it expects back; the class
 * documents only what it adds on top.
 *
 * ### Lifecycle
 *
 * 1. `NestFactory.create()` calls {@link HttpServer.initHttpServer} so that
 *    {@link HttpServer.getHttpServer} returns a native server before
 *    `app.init()` runs.
 * 2. `app.init()` applies the `cors` option through
 *    {@link HttpServer.enableCors}, then awaits {@link HttpServer.init}, then
 *    calls {@link HttpServer.registerParserMiddleware} (unless
 *    `bodyParser: false`), then registers middleware through
 *    {@link HttpServer.createMiddlewareFactory}, then routes through the
 *    verb methods, and finally {@link HttpServer.setNotFoundHandler} and
 *    {@link HttpServer.setErrorHandler}.
 * 3. `app.listen()` calls {@link HttpServer.listen}.
 * 4. `app.close()` calls {@link HttpServer.beforeClose} before the shutdown
 *    hooks run, and {@link HttpServer.close} after every module has been
 *    disposed.
 *
 * ### Requirements on the request, response and server objects
 *
 * The core treats `TRequest` and `TResponse` as opaque and always goes
 * through the adapter, with two exceptions that an implementation must be
 * aware of:
 *
 * - Server-Sent Events (`@Sse()`) write straight to the response object as a
 *   Node.js writable stream (`writeHead`, `write`, `end`, `writableEnded`) and
 *   read `request.socket` to detect client disconnects. `TResponse` must
 *   therefore be, or wrap and expose, a Node.js `ServerResponse`, and
 *   `TRequest` an `IncomingMessage`.
 * - The value returned by {@link HttpServer.getHttpServer} must behave like a
 *   Node.js `net.Server`: `app.listen()` subscribes to its `'error'` event and
 *   reads `address()`, and the WebSocket adapters attach to it.
 *
 * ### Optional members
 *
 * Members marked optional are checked for presence before being called; the
 * fallback behavior is described on each one. Note that `AbstractHttpAdapter`
 * declares several of them abstract, so a class-based adapter has to
 * implement them anyway.
 *
 * @typeParam TRequest - Type of the framework request object handed to
 * handlers and to the `getRequest*` helpers.
 * @typeParam TResponse - Type of the framework response object handed to
 * handlers and to the `reply`/`status`/`setHeader` family.
 * @typeParam ServerInstance - Type of the framework application instance
 * returned by {@link HttpServer.getInstance} (e.g. the Express `Application`),
 * as opposed to the native HTTP server returned by
 * {@link HttpServer.getHttpServer}.
 *
 * @see [HTTP adapter](https://docs.nestjs.com/faq/http-adapter)
 *
 * @publicApi
 */
export interface HttpServer<
  TRequest = any,
  TResponse = any,
  ServerInstance = any,
> {
  /**
   * Registers a global middleware, optionally mounted under `path`.
   *
   * Called by `app.use()`, by the core when registering the parser and
   * exception layers, and as the fallback route registrar when an optional
   * HTTP-verb method (e.g. `propfind`) is not implemented, in which case the
   * route matches every method.
   *
   * The handler may be a {@link RequestHandler} or an {@link ErrorHandler};
   * Express-style adapters distinguish them by arity.
   */
  use(
    handler:
      RequestHandler<TRequest, TResponse> | ErrorHandler<TRequest, TResponse>,
  ): any;
  use(
    path: string,
    handler:
      RequestHandler<TRequest, TResponse> | ErrorHandler<TRequest, TResponse>,
  ): any;
  /**
   * Registers an additional body parser, called by `app.useBodyParser()`.
   *
   * The core inserts the application's `rawBody` option as the **second**
   * argument, so the effective call is
   * `useBodyParser(type, rawBody, ...userArgs)`. When `rawBody` is `true` the
   * parser must expose the unparsed payload as `req.rawBody` (see
   * `RawBodyRequest`).
   *
   * When not implemented, `app.useBodyParser()` logs a warning and does
   * nothing.
   */
  useBodyParser?(...args: any[]): any;
  /**
   * Registers a `GET` route.
   *
   * Every verb method receives the already normalized path (see
   * {@link HttpServer.normalizePath}) and a {@link RequestHandler} that the
   * adapter must invoke as `(req, res, next)`. Routes are registered in the
   * order the core resolves them; see
   * {@link HttpServer.isRouteOrderSensitive}.
   */
  get(handler: RequestHandler<TRequest, TResponse>): any;
  get(path: string, handler: RequestHandler<TRequest, TResponse>): any;
  /**
   * Registers a `POST` route. See {@link HttpServer.get} for the handler
   * contract.
   */
  post(handler: RequestHandler<TRequest, TResponse>): any;
  post(path: string, handler: RequestHandler<TRequest, TResponse>): any;
  /**
   * Registers a `HEAD` route. See {@link HttpServer.get} for the handler
   * contract.
   */
  head(handler: RequestHandler<TRequest, TResponse>): any;
  head(path: string, handler: RequestHandler<TRequest, TResponse>): any;
  /**
   * Registers a `DELETE` route. See {@link HttpServer.get} for the handler
   * contract.
   */
  delete(handler: RequestHandler<TRequest, TResponse>): any;
  delete(path: string, handler: RequestHandler<TRequest, TResponse>): any;
  /**
   * Registers a `PUT` route. See {@link HttpServer.get} for the handler
   * contract.
   */
  put(handler: RequestHandler<TRequest, TResponse>): any;
  put(path: string, handler: RequestHandler<TRequest, TResponse>): any;
  /**
   * Registers a `PATCH` route. See {@link HttpServer.get} for the handler
   * contract.
   */
  patch(handler: RequestHandler<TRequest, TResponse>): any;
  patch(path: string, handler: RequestHandler<TRequest, TResponse>): any;
  /**
   * Registers a WebDAV `PROPFIND` route. Optional: when not implemented the
   * core falls back to {@link HttpServer.use}, which matches every method.
   */
  propfind?(handler: RequestHandler<TRequest, TResponse>): any;
  propfind?(path: string, handler: RequestHandler<TRequest, TResponse>): any;
  /**
   * Registers a WebDAV `PROPPATCH` route. Optional: when not implemented the
   * core falls back to {@link HttpServer.use}, which matches every method.
   */
  proppatch?(handler: RequestHandler<TRequest, TResponse>): any;
  proppatch?(path: string, handler: RequestHandler<TRequest, TResponse>): any;
  /**
   * Registers a WebDAV `MKCOL` route. Optional: when not implemented the
   * core falls back to {@link HttpServer.use}, which matches every method.
   */
  mkcol?(handler: RequestHandler<TRequest, TResponse>): any;
  mkcol?(path: string, handler: RequestHandler<TRequest, TResponse>): any;
  /**
   * Registers a WebDAV `COPY` route. Optional: when not implemented the
   * core falls back to {@link HttpServer.use}, which matches every method.
   */
  copy?(handler: RequestHandler<TRequest, TResponse>): any;
  copy?(path: string, handler: RequestHandler<TRequest, TResponse>): any;
  /**
   * Registers a WebDAV `MOVE` route. Optional: when not implemented the
   * core falls back to {@link HttpServer.use}, which matches every method.
   */
  move?(handler: RequestHandler<TRequest, TResponse>): any;
  move?(path: string, handler: RequestHandler<TRequest, TResponse>): any;
  /**
   * Registers a WebDAV `LOCK` route. Optional: when not implemented the
   * core falls back to {@link HttpServer.use}, which matches every method.
   */
  lock?(handler: RequestHandler<TRequest, TResponse>): any;
  lock?(path: string, handler: RequestHandler<TRequest, TResponse>): any;
  /**
   * Registers a WebDAV `UNLOCK` route. Optional: when not implemented the
   * core falls back to {@link HttpServer.use}, which matches every method.
   */
  unlock?(handler: RequestHandler<TRequest, TResponse>): any;
  unlock?(path: string, handler: RequestHandler<TRequest, TResponse>): any;
  /**
   * Registers a route for every HTTP method (`@All()`). See
   * {@link HttpServer.get} for the handler contract.
   */
  all(path: string, handler: RequestHandler<TRequest, TResponse>): any;
  all(handler: RequestHandler<TRequest, TResponse>): any;
  /**
   * Registers an `OPTIONS` route. See {@link HttpServer.get} for the handler
   * contract.
   */
  options(handler: RequestHandler<TRequest, TResponse>): any;
  options(path: string, handler: RequestHandler<TRequest, TResponse>): any;
  /**
   * Registers a `SEARCH` route. Optional: when not implemented the core falls
   * back to {@link HttpServer.use}, which matches every method.
   */
  search?(handler: RequestHandler<TRequest, TResponse>): any;
  search?(path: string, handler: RequestHandler<TRequest, TResponse>): any;
  /**
   * Registers a `QUERY` route. Optional: when not implemented the core falls
   * back to {@link HttpServer.use}, which matches every method.
   */
  query?(handler: RequestHandler<TRequest, TResponse>): any;
  query?(path: string, handler: RequestHandler<TRequest, TResponse>): any;
  /**
   * Starts accepting connections; called by `app.listen()` once the
   * application has been initialized.
   *
   * The core always appends its own callback as the **last** argument, and
   * strips any callback the user passed to `app.listen()`. The adapter must
   * invoke that callback once the server is listening, or with an `Error` as
   * first argument when it failed to bind; the core rejects the `listen()`
   * promise in that case. The core additionally subscribes to the `'error'`
   * event of {@link HttpServer.getHttpServer} while binding.
   *
   * @param port Port number, or a string such as a pipe/socket path.
   * @param hostname Optional host to bind to.
   * @param callback Invoked as `(err?)` once listening or on failure.
   */
  listen(port: number | string, callback?: () => void): any;
  listen(port: number | string, hostname: string, callback?: () => void): any;
  /**
   * Sends the final response body. This is the single write path used by the
   * router for every handler that does not use `@Res()`, and by the built-in
   * exception filter, so it has to cover the following cases:
   *
   * - `statusCode` provided: apply it before sending.
   * - `body` is `null`/`undefined`: end the response with an empty body.
   * - `body` is a `StreamableFile`: set `Content-Type`, `Content-Disposition`
   *   and `Content-Length` from `body.getHeaders()` unless already present,
   *   pipe `body.getStream()` into the response, route stream errors to
   *   `body.errorHandler(err, response)` and log write errors through
   *   `body.errorLogger(err)`.
   * - `body` is an object or array: serialize as JSON.
   * - anything else: send `String(body)`.
   *
   * @param response Framework response object.
   * @param body Value returned by the route handler (after interceptors).
   * @param statusCode Status to apply, when the router determined one.
   */
  reply(response: any, body: any, statusCode?: number): any;
  /**
   * Sets the status code without sending the response. Called before the
   * handler runs with the status derived from `@HttpCode()` or the method
   * default (`201` for `POST`, `200` otherwise).
   */
  status(response: any, statusCode: number): any;
  /**
   * Terminates the response, optionally writing `message` first. The
   * exception layer uses it when {@link HttpServer.isHeadersSent} reports that
   * a reply already started, so the adapter must not attempt to set headers
   * or a status here.
   */
  end(response: any, message?: string): any;
  /**
   * Renders a view template; called for handlers decorated with `@Render()`
   * with the (awaited) handler result as `options`.
   */
  render(response: any, view: string, options: any): any;
  /**
   * Issues a redirect; called for handlers decorated with `@Redirect()`.
   * `statusCode` is always provided (defaults to `302`), and `url` may come
   * from the handler result `{ url, statusCode }` overriding the decorator.
   */
  redirect(response: any, statusCode: number, url: string): any;
  /**
   * Reports whether the response headers have already been flushed. The
   * exception layer checks it to decide between {@link HttpServer.reply} and
   * {@link HttpServer.end}.
   */
  isHeadersSent(response: any): boolean;
  /**
   * Sets (replaces) a response header; called once per `@Header()` decorator
   * before the handler runs.
   */
  setHeader(response: any, name: string, value: string): any;
  /**
   * Installs the global exception layer: an {@link ErrorHandler} that
   * forwards errors to the registered exception filters. The core calls it
   * once, after every route has been registered, and skips it when not
   * implemented.
   *
   * The handler must be reached by errors thrown from any route or
   * middleware registered through the adapter. The passed value is first run
   * through `AbstractHttpAdapter.mapException()` so framework-native errors
   * can be translated to `HttpException`s.
   *
   * @param handler The `(err, req, res, next)` callback.
   * @param prefix The global prefix (`app.setGlobalPrefix()`), when set.
   * Routes excluded from the prefix still live at the root, so an adapter that
   * scopes error handlers by path must cover both.
   */
  setErrorHandler?(handler: Function, prefix?: string): any;
  /**
   * Installs the catch-all handler for unmatched requests. The core calls it
   * once, after every route has been registered, and skips it when not
   * implemented.
   *
   * The handler is a {@link RequestHandler} that throws `NotFoundException`
   * through the exception filters, so the adapter only has to make sure it
   * runs after all routes and middleware, and only for requests no route
   * matched.
   *
   * @param handler The `(req, res, next)` callback.
   * @param prefix The global prefix (`app.setGlobalPrefix()`), when set.
   */
  setNotFoundHandler?(handler: Function, prefix?: string): any;
  /**
   * Serves static files; pass-through for `app.useStaticAssets()`. The
   * arguments are platform-specific. When not implemented,
   * `app.useStaticAssets()` silently does nothing.
   */
  useStaticAssets?(...args: any[]): this;
  /**
   * Sets the directory (or directories) where view templates live;
   * pass-through for `app.setBaseViewsDir()`. When not implemented,
   * `app.setBaseViewsDir()` silently does nothing.
   */
  setBaseViewsDir?(path: string | string[]): this;
  /**
   * Configures the template engine used by {@link HttpServer.render};
   * pass-through for `app.setViewEngine()`. The argument is
   * platform-specific (an engine name for Express, an options object for
   * Fastify). When not implemented, `app.setViewEngine()` silently does
   * nothing.
   */
  setViewEngine?(engineOrOptions: any): this;
  /**
   * Returns a function the middleware module uses to mount Nest middleware
   * (`MiddlewareConsumer`) for one HTTP method.
   *
   * The returned function is called as `(path, callback)` once per route
   * path the middleware applies to, where `callback` is a
   * {@link RequestHandler} that calls `next()` to continue the chain. The core
   * passes `/` for empty or root paths. When `method` is not
   * `RequestMethod.ALL`, the core already wraps `callback` to skip requests
   * whose {@link HttpServer.getRequestMethod} does not match (treating `HEAD`
   * as `GET`), so a framework that cannot register method-specific middleware
   * may mount it for every method.
   *
   * May return a promise (e.g. when a middleware plugin has to be loaded
   * first); the core awaits it.
   */
  createMiddlewareFactory(
    method: RequestMethod,
  ):
    | ((path: string, callback: Function) => any)
    | Promise<(path: string, callback: Function) => any>;
  /**
   * Returns the request host name (without port), used to match
   * `@Controller({ host })`. Required whenever host filtering is used.
   */
  getRequestHostname?(request: TRequest): string;
  /**
   * Returns the request method as the upper-case verb (`'GET'`, `'HEAD'`,
   * ...), i.e. a key of the `RequestMethod` enum. Used by the middleware
   * module to filter by method and by the not-found handler message.
   */
  getRequestMethod?(request: TRequest): string;
  /**
   * Returns the original request URL, including the query string and
   * independent of any router mount point (Express `req.originalUrl`, not
   * `req.url`). The core strips the query string itself when it needs the
   * pathname, e.g. to evaluate `MiddlewareConsumer.exclude()`.
   */
  getRequestUrl?(request: TRequest): string;
  /**
   * Returns the framework application instance (e.g. the Express
   * `Application`) that the adapter delegates to. Exposed to users through
   * `app.getHttpAdapter().getInstance()`.
   */
  getInstance(): ServerInstance;
  /**
   * Registers the default body parsers. Called once during `app.init()`
   * unless the application was created with `bodyParser: false`, as
   * `registerParserMiddleware(globalPrefix, rawBody)`.
   *
   * Implementations should register JSON and URL-encoded parsers, and, when
   * `rawBody` is `true`, expose the unparsed payload as `req.rawBody` (see
   * `RawBodyRequest`). Because users may register the same parsers
   * beforehand, this should be idempotent.
   */
  registerParserMiddleware(...args: any[]): any;
  /**
   * Enables CORS. Called by `app.enableCors(options)` and during
   * `app.init()` when the `cors` application option is set; `options` is
   * then either the `CorsOptions`/delegate the user provided, or `undefined`
   * for `cors: true`.
   */
  enableCors(options: any): any;
  /**
   * Returns the native HTTP server created by
   * {@link HttpServer.initHttpServer}. It must behave like a Node.js
   * `net.Server` (`listen`, `close`, `address`, `on('error')`), since
   * `app.listen()` and the WebSocket adapters use it directly.
   */
  getHttpServer(): any;
  /**
   * Creates the native HTTP(S) server so that {@link HttpServer.getHttpServer}
   * can return it. Called by `NestFactory.create()` before `app.init()`.
   *
   * The adapter is responsible for honoring the relevant application
   * options: `httpsOptions` (create an HTTPS server),
   * `forceCloseConnections` (track sockets so {@link HttpServer.close} can
   * destroy them) and `return503OnClosing` (reject requests once
   * {@link HttpServer.beforeClose} ran).
   */
  initHttpServer(options: NestApplicationOptions): void;
  /**
   * Stops the server and releases its resources. Called by `app.close()`
   * after the WebSocket and microservice modules have been closed. May return
   * a promise; the core awaits it.
   */
  close(): any;
  /**
   * Called by `app.close()` **before** the shutdown hooks (`OnModuleDestroy`,
   * `BeforeApplicationShutdown`, ...) run, so the adapter can flip into a
   * "shutting down" state, e.g. start answering `503` when
   * `return503OnClosing` is enabled. May return a promise.
   */
  beforeClose?(): any;
  /**
   * Returns a stable identifier for the platform (`'express'`, `'fastify'`).
   * The core does not read it, but ecosystem packages (e.g. `@nestjs/swagger`,
   * `@nestjs/serve-static`) branch on it to pick platform-specific code
   * paths, so custom adapters wrapping one of the built-in frameworks should
   * return the matching value.
   */
  getType(): string;
  /**
   * Asynchronous setup hook. Awaited at the start of `app.init()`, after the
   * `cors` option has been applied and before the parsers, middleware and
   * routes are registered. Use it for work that cannot happen in the
   * constructor, such as loading a plugin.
   */
  init?(): Promise<void>;
  /**
   * Wraps a route handler so that it only runs for requests carrying a
   * matching version. Called once per versioned route for the `HEADER`,
   * `MEDIA_TYPE` and `CUSTOM` versioning types; URI versioning is expressed
   * in the path and never reaches this method.
   *
   * Two strategies are valid:
   * - return a `(req, res, next)` function that extracts the requested
   *   version, invokes `handler` when it matches and calls `next()` otherwise
   *   (Express), or
   * - return `handler` itself, annotated so the framework's own routing can
   *   apply the constraint (Fastify).
   *
   * @param handler The route handler to guard.
   * @param version Version(s) the route serves: a string, an array of
   * strings, or `VERSION_NEUTRAL`. An array may include `VERSION_NEUTRAL`,
   * meaning the route also serves requests that carry no version.
   * @param versioningOptions The options passed to `app.enableVersioning()`.
   */
  applyVersionFilter(
    handler: Function,
    version: VersionValue,
    versioningOptions: VersioningOptions,
  ): (req: TRequest, res: TResponse, next: () => void) => Function;
  /**
   * Converts a Nest route path into the syntax the underlying router
   * expects, and validates it. Called once per route path (already prefixed
   * and versioned) before it is handed to a verb method; should throw when
   * the path is invalid so misconfigured routes fail at startup. When not
   * implemented the path is used verbatim.
   */
  normalizePath?(path: string): string;
  /**
   * Tells the core whether the underlying router picks the **first**
   * registered route that matches (`true`, e.g. Express) or the most specific
   * one regardless of order (`false`, e.g. Fastify). Defaults to `true` when
   * not implemented.
   *
   * When `true` and the `specificity` route resolution strategy is enabled,
   * the core sorts routes before registering them. A `false` value is
   * currently also taken to mean that the router rejects duplicate
   * `(method, path)` registrations itself.
   */
  isRouteOrderSensitive?(): boolean;
}
