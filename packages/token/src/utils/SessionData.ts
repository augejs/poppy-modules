import { Commands } from 'ioredis';

class BaseSessionData {
  private _redis!: Commands;
  private _dataDirty: boolean = false;

  public readonly token!: string;
  public readonly createAt!: number;
  public readonly maxAge!: number;
  public readonly updateAt!: number;

  [key: string]: any;

  constructor(props: {[key: string]: any}) {
    const self: any = this;
    for (let [key, value] of Object.entries(props)) {
      self[key] = value;
    }
  }

  toJSON(): any {
    const obj: {[key: string]: any} = {};
    Object.keys(this).forEach((key: string) => {
      if (typeof key !== 'string') return;
      if (key[0] === '_') return;
      if ((this as any)[key] === undefined) return;
      obj[key] = (this as any)[key];
    });

    return obj;
  }

  get length() {
    return Object.keys(this.toJSON()).length;
  }

  flush() {
    (this as any).updateAt = Date.now();
    this._dataDirty = true;
  }

  async save(force?:boolean) {
    if (!force && !this._dataDirty) {
      return;
    }
    await this._redis.set(this.token, JSON.stringify(this.toJSON()), 'PX', this.maxAge);
    this._dataDirty = false;
  }

  async active() {
    await this._redis.expire(this.token, this.maxAge * 0.001);
  }
}

export class AccessData extends BaseSessionData {
  public isDead: boolean = false;

  public readonly userId!: string;
  public readonly fingerprint!: string;
  public readonly ip!: string;
}

// export class AuthData extends BaseSessionData {
  
//   public readonly sessionName!: string;
//   // module names step
//   public readonly steps!: string[];

//   popStep() {
//     if (!Array.isArray(this.steps)) return;

//     this.steps.shift();
//     this.flush();
//   }

//   pushStep(step: string) {
//     if (!Array.isArray(this.steps)) return;

//     this.steps.push(step);
//     this.flush();
//   }

//   get nextStep():string | boolean {
//     if (!Array.isArray(this.steps)) return false;

//     return this.steps[0] || false;
//   }

//   hasNextStep() {
//     if (!Array.isArray(this.steps)) return false;

//     return this.steps.length > 0;
//   }
// }
