import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { NotificationModule } from '../src/app.module';
import { SlackCommandsController } from '../src/controllers/slack-commands.controller';
import { ThreadManagerService } from '../src/services/thread-manager.service';
import { MessageFormatterService } from '../src/services/message-formatter.service';

describe('SlackCommandsController', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [],
      controllers: [SlackCommandsController],
      providers: [ThreadManagerService, MessageFormatterService],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responds to slash command with ephemeral message', async () => {
    const res = await request(app.getHttpServer())
      .post('/slack/commands')
      .send({ command: '/mylo', text: '' });
    expect(res.status).toBe(200);
    expect(res.body.response_type).toBe('ephemeral');
  });
});
