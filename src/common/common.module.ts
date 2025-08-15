import { Module } from '@nestjs/common';
import { OneSignalService } from './services/onesignal.service';

@Module({
  providers: [OneSignalService],
  exports: [OneSignalService],
})
export class CommonModule {}
