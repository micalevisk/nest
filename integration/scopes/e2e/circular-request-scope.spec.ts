import { INestApplication, Scope } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { expect } from 'chai';
import * as request from 'supertest';
import { HelloController } from '../src/circular-hello/hello.controller';
import { HelloModule } from '../src/circular-hello/hello.module';
import { HelloService } from '../src/circular-hello/hello.service';
import { UsersService } from '../src/circular-hello/users/users.service';

class Meta {
  static COUNTER = 0;
  constructor(private readonly helloService: HelloService) {
    Meta.COUNTER++;
  }
}

describe('Circular request scope', () => {
  let server;
  let app: INestApplication;

  before(async () => {
    const module = await Test.createTestingModule({
      imports: [
        HelloModule.forRoot({
          provide: 'META',
          useClass: Meta,
          scope: Scope.REQUEST,
        }),
      ],
    }).compile();

    app = module.createNestApplication();
    server = app.getHttpServer();
    await app.init();
  });

  describe('when one service is request scoped', () => {
    before(async () => {
      const performHttpCall = end =>
        request(server)
          .get('/hello')
          .end((err, res) => {
            if (err) return end(err);
            end();
          });
      await new Promise(resolve => performHttpCall(resolve));
      await new Promise(resolve => performHttpCall(resolve));
      await new Promise(resolve => performHttpCall(resolve));
    });

    it(`should create controller for each request`, () => {
      expect(HelloController.COUNTER).to.be.eql(3);
    });

    it(`should create service for each request`, () => {
      expect(UsersService.COUNTER).to.be.eql(3);
    });

    it(`should create service for each request`, () => {
      expect(HelloService.COUNTER).to.be.eql(3);
    });

    it(`should create provider for each inquirer`, () => {
      expect(Meta.COUNTER).to.be.eql(3);
    });
  });

  after(async () => {
    await app.close();
  });
});
