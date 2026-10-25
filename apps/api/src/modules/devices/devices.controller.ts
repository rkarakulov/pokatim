import { Body, Controller, Get, Header, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import {
  CompleteDeviceRequest,
  ConnectDeviceRequest,
  type ConnectDeviceResponse,
  type DeviceList,
  DeviceProvider,
  DisconnectDeviceRequest,
  FieldErrorCode,
} from '@pokatim/contracts';
import { ZodValidationPipe } from '@rkarakulov/api-kit/core';

import { AuthGuard, type AuthUser, CurrentUser } from '../identity';
import { DevicesLinkService } from './devices-link.service';
import { DevicesService } from './devices.service';

const ProviderParam = new ZodValidationPipe(DeviceProvider, FieldErrorCode);

/**
 * Экран «Устройства» и подключение (§8.3 п. 1): только для вошедших (`AuthGuard`), пользователь — `@CurrentUser()`;
 * `:provider` — строгий enum; ответы `no-store`, без идентификаторов агрегатора и тикетов.
 */
@Controller('devices')
@UseGuards(AuthGuard)
export class DevicesController {
  constructor(
    private readonly devices: DevicesService,
    private readonly link: DevicesLinkService,
  ) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@CurrentUser() user: AuthUser): Promise<DeviceList> {
    return this.devices.list(user.userId);
  }

  @Post(':provider/connect')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  connect(
    @CurrentUser() user: AuthUser,
    @Param('provider', ProviderParam) provider: DeviceProvider,
    @Body(new ZodValidationPipe(ConnectDeviceRequest, FieldErrorCode)) body: ConnectDeviceRequest,
  ): Promise<ConnectDeviceResponse> {
    return this.link.connect(user.userId, provider, body.returnUrl);
  }

  @Post(':provider/complete')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  complete(
    @CurrentUser() user: AuthUser,
    @Param('provider', ProviderParam) provider: DeviceProvider,
    @Body(new ZodValidationPipe(CompleteDeviceRequest, FieldErrorCode)) body: CompleteDeviceRequest,
  ): Promise<DeviceList> {
    return this.link.complete(user.userId, provider, body.ticket);
  }

  @Post(':provider/sync')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  sync(
    @CurrentUser() user: AuthUser,
    @Param('provider', ProviderParam) provider: DeviceProvider,
  ): Promise<DeviceList> {
    return this.devices.sync(user.userId, provider);
  }

  @Post(':provider/disconnect')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  disconnect(
    @CurrentUser() user: AuthUser,
    @Param('provider', ProviderParam) provider: DeviceProvider,
    @Body(new ZodValidationPipe(DisconnectDeviceRequest, FieldErrorCode))
    body: DisconnectDeviceRequest,
  ): Promise<DeviceList> {
    return this.devices.disconnect(user.userId, provider, body.deleteActivities);
  }
}
