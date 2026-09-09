/** Invalidates work started before logout/account replacement, including delayed callbacks. */
let controller = new AbortController();

export function captureSessionScope() {
  const signal = controller.signal;
  return {
    signal,
    assertCurrent() {
      if (signal.aborted) throw new Error('登录会话已变更，旧任务已取消');
    },
  };
}

export function invalidateSessionScope(): void {
  const previous = controller;
  controller = new AbortController();
  previous.abort();
}
