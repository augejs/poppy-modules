import { Module } from '@augejs/module-core';
import { Prefix } from '@augejs/koa';
import { OperatorModule } from './operator/Operator.module';

@Prefix('/poppy')
@Module({
  subModules: [
    OperatorModule
  ]
})
export class PoppyAdminModule {
}
