import { Prefix, RequestMapping } from '@augejs/koa';
import { Provider, Inject } from '@augejs/module-core';
import { REDIS_IDENTIFIER } from '@augejs/redis';
import { Commands } from 'ioredis';

@Provider()
@Prefix('forget-password')
export class ForgetPasswordController {

  @Inject(REDIS_IDENTIFIER)
  redis!: Commands

  /**
   * @apiVersion 1.0.0
   * @api {post} /api/base/v1/operator/forget-password/authorization 修改密码授权申请
   *
   * @apiDescription 修改密码授权申请
   *
   * @apiGroup ForgetPassword
   *
   * @apiParam  {String} loginName 用户名
   * @apiParam  {String} domain 应用域名
   * @apiParam  {String} captcha 验证码
   * @apiParam  {String} captchaToken 验证码token
   *
   * @apiSuccess (成功) {Object} data
   *
   * @apiError (失败) {String} F401 未授权
   *
   * @apiSampleRequest /api/base/v1/operator/forget-password/auth
   *
   */

  @RequestMapping.Get()
  async auth() {
 
    await this.redis.set('asdadad', '---');

    return '123';
  }
}
