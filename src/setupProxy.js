const { createProxyMiddleware } = require('http-proxy-middleware');

module.exports = function configureDevelopmentProxy(app) {
  const target = process.env.REACT_APP_SUPABASE_URL;
  if (!target) return;

  app.use('/api/auth', createProxyMiddleware({
    target,
    changeOrigin: true,
    secure: true,
    pathRewrite: { '^/api/auth': '/functions/v1' },
  }));
};
