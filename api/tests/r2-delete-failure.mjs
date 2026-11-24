import Api from '../build/index.js';

export default {
  fetch(request, env, ctx) {
    if (request.headers.has('X-Test-Fail-R2-Delete')) {
      const files = Object.create(env.FILES);
      files.delete = async () => { throw new Error('Simulated R2 delete failure'); };
      env = { ...env, FILES: files };
    }
    return new Api(ctx, env).fetch(request);
  },
  scheduled(event, env, ctx) {
    return new Api(ctx, env).scheduled(event);
  }
};
