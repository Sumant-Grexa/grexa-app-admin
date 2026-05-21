export class ReleaseStep {
  get name() {
    return this.constructor.name;
  }

  /** @param {import("../releaseContext.js").ReleaseContext} ctx */
  async run(ctx) {
    throw new Error(`${this.name}.run() not implemented`);
  }

  /** @param {import("../releaseContext.js").ReleaseContext} ctx */
  async execute(ctx) {
    ctx.append(`▶ ${this.name}`);
    await this.run(ctx);
    ctx.append(`✓ ${this.name} done`);
  }
}
