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
import DeleteAccountScreen from '../app/settings/account/delete';
import TicketRoute from '../app/tickets/[code]';
import ProfileScreen from '../app/settings/profile';
import OwnProfileRoute from '../app/profile';
import RiderRoute from '../app/riders/[id]';
import ReportRiderRoute from '../app/riders/report/[id]';
import SettingsScreen from '../app/settings/index';
import LanguageScreen from '../app/settings/language';
import ThemeScreen from '../app/settings/theme';
import NotificationsScreen from '../app/notifications';
import NotificationSettingsScreen from '../app/settings/notifications';
import VerifiedProfileScreen from '../app/settings/verified';
import VerifyEmailScreen from '../app/auth/verify/[token]';
import RootLayout from '../app/_layout';
import CalendarStartRoute from '../app/calendar/[id]';
import RideRoute from '../app/rides/[id]';
import NewRideRoute from '../app/rides/new';
import EditRideRoute from '../app/rides/edit/[id]';
import CancelRideRoute from '../app/rides/cancel/[id]';
import RideInviteRoute from '../app/rides/invite/[id]';
import ReportRideRoute from '../app/rides/report/[id]';
import RideRoutePickRoute from '../app/rides/route-pick';
import RaceRoute from '../app/races/[id]';
import CatalogRouteRoute from '../app/routes/[id]';
import MyRouteRoute from '../app/routes/mine/[id]';
import MyRoutePublishRoute from '../app/routes/mine/publish/[id]';
import ReportRouteRoute from '../app/routes/report/[id]';
import RouteStoryRoute from '../app/routes/story/[id]';
import RouteRidePickRoute from '../app/routes/pick/[routeId]';
import RouteRideRoute from '../app/routes/rides/[routeId]/[rideId]';
import RacePickRoute from '../app/races/pick/[id]';
import DisputeResponseRoute from '../app/races/dispute-response/[id]/[disputeId]';
import FileDisputeRoute from '../app/races/dispute/[id]/[entryId]';
import RivalResultRoute from '../app/races/result/[id]/[entryId]';
import StoryCardRoute from '../app/races/story/[id]';
import AchievementFlashRoute from '../app/achievements/flash';
import AchievementRoute from '../app/achievements/[code]';
import AchievementStoryRoute from '../app/achievements/story/[code]';
import SeasonRoute from '../app/seasons/[id]';
import StatusScreen from '../app/status';
import UiKitScreen from '../app/ui-kit';
import NotFoundRoute from '../app/+not-found';
import WelcomeRoute from '../app/welcome';

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
  // гостевой лендинг (guest-landing, RC-1): корневой экран рядом с группой регистрации
  welcome: WelcomeRoute,
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
  'settings/index': SettingsScreen,
  'settings/language': LanguageScreen,
  'settings/theme': ThemeScreen,
  'settings/profile': ProfileScreen,
  profile: OwnProfileRoute,
  notifications: NotificationsScreen,
  'settings/notifications': NotificationSettingsScreen,
  'settings/verified': VerifiedProfileScreen,
  'settings/account/delete': DeleteAccountScreen,
  'tickets/[code]': TicketRoute,
  'devices/return': DeviceReturnScreen,
  'auth/verify/[token]': VerifyEmailScreen,
  'auth/reset/[token]': ResetPasswordScreen,
  'ui-kit': UiKitScreen,
  '+not-found': NotFoundRoute,
  status: StatusScreen,
  'races/[id]': RaceRoute,
  'races/pick/[id]': RacePickRoute,
  'races/result/[id]/[entryId]': RivalResultRoute,
  'races/story/[id]': StoryCardRoute,
  'achievements/flash': AchievementFlashRoute,
  'achievements/[code]': AchievementRoute,
  'achievements/story/[code]': AchievementStoryRoute,
  'races/dispute/[id]/[entryId]': FileDisputeRoute,
  'races/dispute-response/[id]/[disputeId]': DisputeResponseRoute,
  'routes/[id]': CatalogRouteRoute,
  'routes/mine/[id]': MyRouteRoute,
  'routes/mine/publish/[id]': MyRoutePublishRoute,
  'routes/report/[id]': ReportRouteRoute,
  'routes/story/[id]': RouteStoryRoute,
  'riders/report/[id]': ReportRiderRoute,
  'routes/pick/[routeId]': RouteRidePickRoute,
  'routes/rides/[routeId]/[rideId]': RouteRideRoute,
  'seasons/[id]': SeasonRoute,
  'calendar/[id]': CalendarStartRoute,
  'rides/[id]': RideRoute,
  'rides/new': NewRideRoute,
  'rides/edit/[id]': EditRideRoute,
  'rides/cancel/[id]': CancelRideRoute,
  'rides/report/[id]': ReportRideRoute,
  'rides/invite/[id]': RideInviteRoute,
  'rides/route-pick': RideRoutePickRoute,
  'riders/[id]': RiderRoute,
};
