import { EventEmitter } from 'events';
import { ChildProcess } from 'child_process';
import {
  guardMediaProcess,
  MediaProcessStartError,
  MediaProcessTimeoutError,
} from '../../lib/mediaProcess';

const fakeChild = () => {
  const child = new EventEmitter() as ChildProcess & { kill: jest.Mock };
  child.kill = jest.fn();
  return child;
};

describe('guardMediaProcess', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('rejects when the process fails to start and never emits close', () => {
    const child = fakeChild();
    const reject = jest.fn();

    guardMediaProcess(child, { label: 'ffmpeg', timeoutMs: 1000 }, reject);
    child.emit('error', new Error('spawn ffmpeg ENOENT'));

    expect(reject).toHaveBeenCalledTimes(1);
    expect(reject.mock.calls[0][0]).toBeInstanceOf(MediaProcessStartError);
    expect(reject.mock.calls[0][0].message).toContain('spawn ffmpeg ENOENT');
  });

  it('kills and rejects when the process outlives its ceiling', () => {
    const child = fakeChild();
    const reject = jest.fn();

    guardMediaProcess(child, { label: 'ffmpeg render', timeoutMs: 1000 }, reject);
    expect(reject).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1000);

    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(reject).toHaveBeenCalledTimes(1);
    expect(reject.mock.calls[0][0]).toBeInstanceOf(MediaProcessTimeoutError);
    expect(reject.mock.calls[0][0].message).toContain('ffmpeg render');
  });

  it('does not kill or reject a process that closes in time', () => {
    const child = fakeChild();
    const reject = jest.fn();

    guardMediaProcess(child, { label: 'ffprobe', timeoutMs: 1000 }, reject);
    child.emit('close', 0);
    jest.advanceTimersByTime(60_000);

    expect(child.kill).not.toHaveBeenCalled();
    expect(reject).not.toHaveBeenCalled();
  });

  it('clears the ceiling after a start failure so it cannot fire twice', () => {
    const child = fakeChild();
    const reject = jest.fn();

    guardMediaProcess(child, { label: 'ffmpeg', timeoutMs: 1000 }, reject);
    child.emit('error', new Error('EACCES'));
    jest.advanceTimersByTime(60_000);

    expect(child.kill).not.toHaveBeenCalled();
    expect(reject).toHaveBeenCalledTimes(1);
  });
});
