import CheckEmailScreen from '../app/(onboarding)/check-email';
import ForgotPasswordScreen from '../app/(onboarding)/forgot-password';
import OnboardingLayout from '../app/(onboarding)/_layout';
import RegisterScreen from '../app/(onboarding)/register';
import SetupLayout from '../app/(setup)/_layout';
import SurveyScreen from '../app/(setup)/survey';
import LocationScreen from '../app/(setup)/location';
import DevicesStepScreen from '../app/(setup)/devices';
import SignInScreen from '../app/(onboarding)/sign-in';
import CalendarScreen from '../app/(tabs)/calendar';
import HomeScreen from '../app/(tabs)/index';
import TabsLayout from '../app/(tabs)/_layout';
import RacesScreen from '../app/(tabs)/races';
import RidesScreen from '../app/(tabs)/rides';
import RoutesScreen from '../app/(tabs)/routes';
import ResetPasswordScreen from '../app/auth/reset/[token]';
import DeviceReturnScreen from '../app/devices/return';
import DevicesScreen from '../app/settings/devices';
import VerifyEmailScreen from '../app/auth/verify/[token]';
import RootLayout from '../app/_layout';
import CalendarStartRoute from '../app/calendar/[id]';
import RaceRoute from '../app/races/[id]';
import SeasonRoute from '../app/seasons/[id]';
import StatusScreen from '../app/status';
import UiKitScreen from '../app/ui-kit';

/** Маршруты вкладок для renderRouter (корневой layout подключают отдельные тесты). */
export const tabRoutes = {
  '(tabs)/_layout': TabsLayout,
  '(tabs)/index': HomeScreen,
  '(tabs)/races': RacesScreen,
  '(tabs)/rides': RidesScreen,
  '(tabs)/routes': RoutesScreen,
  '(tabs)/calendar': CalendarScreen,
};

/**
 * Всё приложение: корневой layout с гардом, вкладки, «Устройства», регистрация, шаги онбординга, ссылка из письма,
 * возврат из авторизации устройства, витрина, `/status`.
 */
export const appRoutes = {
  _layout: RootLayout,
  ...tabRoutes,
  '(onboarding)/_layout': OnboardingLayout,
  '(onboarding)/register': RegisterScreen,
  '(onboarding)/check-email': CheckEmailScreen,
  '(onboarding)/sign-in': SignInScreen,
  '(onboarding)/forgot-password': ForgotPasswordScreen,
  '(setup)/_layout': SetupLayout,
  '(setup)/survey': SurveyScreen,
  '(setup)/location': LocationScreen,
  '(setup)/devices': DevicesStepScreen,
  'settings/devices': DevicesScreen,
  'devices/return': DeviceReturnScreen,
  'auth/verify/[token]': VerifyEmailScreen,
  'auth/reset/[token]': ResetPasswordScreen,
  'ui-kit': UiKitScreen,
  status: StatusScreen,
  'races/[id]': RaceRoute,
  'seasons/[id]': SeasonRoute,
  'calendar/[id]': CalendarStartRoute,
};
