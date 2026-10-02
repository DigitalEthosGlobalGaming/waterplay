/**
 * Corner overlay (§13.4.7): instance, build, net state, last restore result.
 * Click to expand the restore log.
 */
export class DevIndicator {
  private readonly el = document.createElement('div');
  private readonly summary = document.createElement('div');
  private readonly details = document.createElement('pre');
  private restoredAt = 0;
  private restoreText = 'fresh start';
  private timer: ReturnType<typeof setInterval>;

  constructor(
    private readonly instance: string,
    private readonly role: string,
    private readonly buildId: string,
    private readonly netText: () => string,
  ) {
    this.el.className = 'dev-indicator';
    this.details.hidden = true;
    this.el.append(this.summary, this.details);
    this.el.addEventListener('click', () => {
      this.details.hidden = !this.details.hidden;
    });
    document.body.append(this.el);
    this.timer = setInterval(() => this.render(), 1000);
    this.render();
  }

  setRestore(result: { warnings: string[]; storeKind: string } | null): void {
    this.restoredAt = performance.now();
    if (!result) {
      this.restoreText = 'fresh start';
      this.details.textContent = 'No snapshot restored.';
    } else {
      this.restoreText = result.warnings.length === 0 ? 'restored' : 'partial restore';
      this.details.textContent = [
        `store: ${result.storeKind}`,
        ...(result.warnings.length ? result.warnings : ['full restore, no warnings']),
      ].join('\n');
    }
    this.el.dataset.partial = String(!!result && result.warnings.length > 0);
    this.render();
  }

  dispose(): void {
    clearInterval(this.timer);
    this.el.remove();
  }

  private render(): void {
    const ago = ((performance.now() - this.restoredAt) / 1000).toFixed(0);
    this.summary.textContent = `${this.instance} · ${this.role} · build ${this.buildId} · ${this.netText()} · ${this.restoreText} ${ago}s ago`;
  }
}
