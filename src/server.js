const app = require('./app');
const logger = require('./logger');

const port = 3000;

app.listen(port, () => logger.info(`Server listening on port ${port}`));
