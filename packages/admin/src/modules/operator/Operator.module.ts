import { Module } from '@augejs/module-core';
import { ForgetPasswordController } from './controllers/ForgetPassword.controller';

@Module({
  providers: [
    ForgetPasswordController
  ]
})
export class OperatorModule {
}
