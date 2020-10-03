import crypto from 'crypto';
import ms from 'ms';

import { Config, IScanContext, IScanNode, LifecycleOnInitHook, Logger, Metadata } from '@augejs/module-core';
import { KOA_WEB_SERVER_IDENTIFIER, MiddlewareFactory, HttpStatus, IKoaContext, IKoaApplication } from '@augejs/koa';
import { I18N_IDENTIFIER, II18n } from '@augejs/i18n';
import { AccessData } from '../utils';
import { REDIS_IDENTIFIER, Commands } from '@augejs/redis';

const ACCESS_TOKE_IDENTIFIER = 'accessToken';
const ACCESS_TOKE_KEY_PREFIX = 'acst';
const ACCESS_TOKE_MAX_AGE= '20m';

const logger = Logger.getLogger(ACCESS_TOKE_IDENTIFIER);

export interface IAccessTokenManager {
  createAccessData(props: Record<string, any>): Promise<AccessData> 
  findAccessDataByToken(token: string): Promise<AccessData | null>
  findAccessDataListByUserId(userId: string, skipCount?: number): Promise<AccessData[]>
  destroyAccessDataByToken(token: string):Promise<void>
}

declare module '@augejs/koa' {
  interface IKoaContext {
    requestFingerprint(): string
    accessTokenManager: IAccessTokenManager
    accessData: AccessData | null
  }
}

type RequestFingerprintFunction =  (ctx: IKoaContext)=>Promise<string> | string;

type AccessTokenConfigOptions = {
  keyPrefix?: string,
  maxAge?: string | number
  autoKeepActive?: boolean
  requestFingerprint?: RequestFingerprintFunction | {
    deviceUUId?: boolean
    ip?: boolean
    userAgent?: boolean
  }
}

export function AccessTokenConfig(opts?: AccessTokenConfigOptions): ClassDecorator {
  return function(target: Function) {
    Metadata.decorate([
      Config({
        [ACCESS_TOKE_IDENTIFIER]: {
          // this will auto keep active for every request.
          keyPrefix: ACCESS_TOKE_KEY_PREFIX,
          maxAge: ACCESS_TOKE_MAX_AGE,
          autoKeepActive: true,
          ...opts,
        }
      }),

      LifecycleOnInitHook(async (scanNode: IScanNode, next: Function) => {
        const context: IScanContext = scanNode.context;
        const koa = context.container.get<IKoaApplication>(KOA_WEB_SERVER_IDENTIFIER);
        const i18n = context.container.get<II18n>(I18N_IDENTIFIER);
        const redis = context.container.get<Commands>(REDIS_IDENTIFIER);

        const config: AccessTokenConfigOptions = {
          ...scanNode.context.rootScanNode!.getConfig(ACCESS_TOKE_IDENTIFIER),
          ...scanNode.getConfig(ACCESS_TOKE_IDENTIFIER),
        };

        koa.context.requestFingerprint = async function () {
          const ctx: IKoaContext = this as IKoaContext;
          if (typeof config?.requestFingerprint === 'function') {
            return await config.requestFingerprint(ctx) || '';
          } else if (!!config?.requestFingerprint) {
            const deviceId: string = config?.requestFingerprint?.deviceUUId && ctx.get('device-uuid') || '';
            const ip: string = config?.requestFingerprint?.ip && ctx.ip || '';
            const userAgent: string = config?.requestFingerprint?.userAgent && ctx.get('user-agent') || ''
            return crypto.createHash('md5').update(`${deviceId}${ip}${userAgent}`).digest('hex');
          }
          return '';
        }

        const keyPrefix: string = config.keyPrefix || ACCESS_TOKE_KEY_PREFIX;

        const accessTokenManager: IAccessTokenManager = {
          async createAccessData(props: Record<string, any>): Promise<AccessData> {
            const userId: string = props.userId;
            const ip: string = props.ip || '';
        
            if (typeof userId !== 'string') {
              throw new Error(i18n.formatMessage({
                id: 'Error_Missing_UserID',
                defaultMessage: 'UserID is Required'
              }));
            };
        
            let maxAgeConfig: string | number = Object.prototype.hasOwnProperty.call(props, 'maxAge') ? props.maxAge : config.maxAge;
            const maxAge: number = typeof maxAgeConfig === 'string' ? ms(maxAgeConfig) : maxAgeConfig;
        
            const timestamp: number = Date.now();
            const nonce: string = crypto.randomBytes(32).toString('hex');
            const hashContent: string = [
              userId,
              ip,
              nonce,
              timestamp
            ].join('');
        
            const token:string = `${keyPrefix}:${userId}:${crypto.createHash('md5').update(hashContent).digest('hex')}`;
            const accessData = new AccessData({
              ...props,
              _redis: redis, 
              token,
              nonce,
              createAt: timestamp,
              updateAt: timestamp,
              _dataDirty: true,
              maxAge, 
            });
        
            return accessData;
          },
        
          async findAccessDataByToken(token: string): Promise<AccessData | null> {
            if (!token || !token.startsWith(`${keyPrefix}:`)) return null;
        
            const jsonResultStr = await redis.get(token);
            if (!jsonResultStr) {
              return null;
            }
        
            let jsonData:any = null;
            try {
              jsonData = JSON.parse(jsonResultStr);
            } catch (err) {
              return null;
            }
        
            return new AccessData({
              ...jsonData,
              _redis: redis,
            });
          },
        
          async findAccessDataListByUserId(userId: string, skipCount?: number): Promise<AccessData[]> {
            let results: AccessData[] = [];
        
            const redisKeyPrefix: string = (redis as any).options.keyPrefix || (redis as any).options.redisOptions?.keyPrefix || '';
            
            let tokens: string[] = await redis.keys(`${redisKeyPrefix}${keyPrefix}:${userId}:*`);
            if (tokens.length === 0) return results;
            for (const token of tokens) {
              // fix the first prefix
              const validToken: string = token.substr(redisKeyPrefix.length);
              const accessData:AccessData | null  = await this.findAccessDataByToken(validToken);
              if (accessData) {
                results.push(accessData as unknown as AccessData);
              }
            }
        
            // last login is the top one
            results.sort((a:AccessData, b: AccessData )=>{
              return b.createAt - a.createAt;
            });

            if ((skipCount as number) > 0) {
              results = results.slice((skipCount as number));
            }
        
            return results;
          },
        
          async destroyAccessDataByToken(token: string):Promise<void> {
            if (!token) return;
        
            await redis.del(token);
          }
        };

        koa.context.accessTokenManager = accessTokenManager;

        await next();
      })
    ], target);
  }
}


type AccessTokenMiddlewareOptions = {
  optional?: boolean
}

// https://github.com/koajs/bodyparser
export function AccessTokenMiddleware(opts?: AccessTokenMiddlewareOptions): ClassDecorator & MethodDecorator {
  return MiddlewareFactory(async (scanNode: IScanNode) => {
    const config: any = {
      ...scanNode.context.rootScanNode!.getConfig(ACCESS_TOKE_IDENTIFIER),
      ...scanNode.getConfig(ACCESS_TOKE_IDENTIFIER),
    };

    const autoKeepActive: boolean = config.autoKeepActive;
    const checkAccessFingerprint = !!config.fingerprint;
    
    const optional: boolean = !!opts?.optional;

    const i18n:II18n = scanNode.context.container.get(I18N_IDENTIFIER);

    return async (ctx: IKoaContext, next: Function) => {
      const accessToken:string = ctx.get('access-token') || (ctx.request as any).body?.authToken || ctx.request.get('authToken');
      if (!accessToken) {
        if (optional) {
          await next();
        } else {
          // https://github.com/ValueFE/egg-access-token/blob/1f3718bc6a71c548236facc5694e96263a20daa6/app/middleware/accessToken.js#L21
          // todo throw error here
          logger.warn(`ip: ${ctx.ip} accessToken is required!`);

          ctx.throw(HttpStatus.UNAUTHORIZED, 
            i18n.formatMessage({
              id: 'Error_Missing_AccessToken',
              defaultMessage: 'AccessToken is Required'
            })
          )
        }
        return;
      }

      let accessData: AccessData | null = await ctx.accessTokenManager.findAccessDataByToken(accessToken);
      if (!accessData) {
        if (optional) {
          await next();
        } else {
          // todo throw error here
          // https://github.com/ValueFE/egg-access-token/blob/1f3718bc6a71c548236facc5694e96263a20daa6/app/middleware/accessToken.js#L35
          logger.info(`ip: ${ctx.ip} accessToken is invalid!`);
          ctx.throw(HttpStatus.UNAUTHORIZED, 
            i18n.formatMessage({
              id: 'Error_Invalid_AccessToken',
              defaultMessage: 'AccessToken Is Invalid'
            })
          )
        }
        return;
      }

      if (accessData!.isDead) {
        logger.info(`userId: ${accessData.userId} accessToken is ready to invalid. message: ${accessData.message}`);
        await ctx.accessTokenManager.destroyAccessDataByToken(accessData.token);
        ctx.throw(HttpStatus.UNAUTHORIZED, accessData.message);
        return;
      }

      if (checkAccessFingerprint && accessData.fingerprint !== ctx.requestFingerprint()) {
        const exceptFingerprint: string = ctx.calculateAccessFingerprint();
        logger.info(`userId: ${accessData.userId} fingerprint is invalid expect: ${exceptFingerprint} receive: ${accessData.fingerprint}`);
        await ctx.accessTokenManager.destroyAccessDataByToken(accessData.token);
        ctx.throw(HttpStatus.UNAUTHORIZED, 
          i18n.formatMessage({
            id: 'Error_Invalid_Client_Fingerprint',
            defaultMessage: 'Client fingerprint is changed!'
          })
        )
      }

      ctx.accessData = accessData;

      await next();

      if (!ctx.accessData) {
        await ctx.accessTokenManager.destroyAccessDataByToken(accessData.token);
        return;
      }

      await accessData.save();

      if (autoKeepActive) {
        await accessData.active();
      }
    }
  })
}
