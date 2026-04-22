const { handler } = require('./netlify/functions/fnguide-fill');

(async () => {
  const response = await handler({
    httpMethod: 'POST',
    body: JSON.stringify({ sourceInput: '005930' }),
  });

  console.log('statusCode:', response.statusCode);
  console.log(response.body);
})();
