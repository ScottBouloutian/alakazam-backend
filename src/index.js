const express = require('express');
const serverless = require('serverless-http');
const aws = require('aws-sdk');
const {
  bindNodeCallback, timer, from, forkJoin,
} = require('rxjs');
const {
  first, switchMap, filter, map,
} = require('rxjs/operators');
const moment = require('moment');
const winston = require('winston');

const app = express();
const cloudWatchLogs = new aws.CloudWatchLogs({ region: 'us-east-1' });
const startQuery = bindNodeCallback((...args) => cloudWatchLogs.startQuery(...args));
const getQueryResults = bindNodeCallback((...args) => cloudWatchLogs.getQueryResults(...args));
const logger = winston.createLogger({
  transports: [
    new winston.transports.Console({
      format: winston.format.simple(),
    }),
  ],
});

const pollQuery = (queryString) => (
  startQuery({
    endTime: moment().unix(),
    queryString,
    startTime: moment().subtract(1, 'month').unix(),
    limit: 1,
    logGroupName: '/aws/lambda/sound-sync-prod-index',
  }).pipe(
    switchMap(({ queryId }) => (
      timer(0, 1000).pipe(
        switchMap(() => getQueryResults({ queryId })),
      )
    )),
    first(({ status }) => status === 'Complete'),
  )
);

app.use(express.json());
app.get('/api/sound-sync', (request, response) => {
  forkJoin([
    pollQuery([
      'fields @timestamp, @message',
      'filter @message like "Downloading artwork"',
      'sort @timestamp desc',
      'limit 1',
    ].join(' | ')).pipe(
      switchMap(({ results }) => from(results[0])),
      filter(({ field }) => field === '@message'),
      map(({ value }) => value.match(/.+Downloading artwork from (.+?)"/)[1]),
    ),
    pollQuery([
      'fields @timestamp, @message',
      'filter @message not like "Exception"',
      'sort @timestamp desc',
      'limit 1',
    ].join(' | ')).pipe(
      switchMap(({ results }) => from(results[0])),
      filter(({ field }) => field === '@timestamp'),
      map(({ value }) => moment(value).unix()),
    ),
  ]).subscribe(
    ([url, timestamp]) => response.send({ url, timestamp }),
    (error) => {
      logger.error(error.message);
      response.sendStatus(500);
    },
  );
});

module.exports.handler = serverless(app);
