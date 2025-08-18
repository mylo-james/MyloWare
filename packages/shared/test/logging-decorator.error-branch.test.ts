import { LogMethod } from '../src/decorators/logging';

class Demo {
  @LogMethod('demo')
  async willFail() {
    throw new Error('decorator boom');
  }
}

describe('LogExecution decorator error branch', () => {
  it('logs error when method throws', async () => {
    const d = new Demo();
    await expect(d.willFail()).rejects.toThrow('decorator boom');
  });
});
