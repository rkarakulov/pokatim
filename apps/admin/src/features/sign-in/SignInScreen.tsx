import { zodResolver } from '@hookform/resolvers/zod';
import { apiErrorOf, isNetworkError } from '@pokatim/api-client';
import { type PanelMe, PanelSignInRequest, RateLimitedDetails } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, useRouter } from '@tanstack/react-router';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { api } from '../../api';
import { FORGOT_PASSWORD_URL } from '../../config';
import { fieldErrorText } from '../../field-errors';
import { ME_QUERY_KEY } from '../../session/me';
import { AuthCard, Banner, Button, TextField } from '../../ui';
import { useNow } from '../../use-now';
import { TotpSetupStep, TotpStep } from './TotpSignInSteps';
import { UnverifiedCard, type UnverifiedState, unverifiedState } from './UnverifiedCard';

const route = getRouteApi('/sign-in');

type View =
  | { kind: 'form' }
  | { kind: 'denied'; email: string }
  | ({ kind: 'unverified' } & UnverifiedState)
  | { kind: 'totp' | 'totpSetup'; email: string; challenge: string };

type FormBanner = 'invalid' | 'network' | 'unknown' | 'totpExpired' | 'totpUnavailable' | undefined;

/** Путь внутри панели → публичный путь с basepath (навигация по `href` снимает basepath сама). */
function publicHref(basepath: string, path: string): string {
  return basepath === '/' ? path : `${basepath}${path}`;
}

/**
 * «Вход в панель» (прототип 3a, D-13): тот же e-mail и пароль, что в приложении. Состояния: покой; неверные данные;
 * «Нет доступа к панели» (верный пароль, роли нет) с введённым адресом; «E-mail не подтверждён» с повтором письма;
 * «Слишком много попыток» — поля неактивны до конца паузы; «Сессия истекла» (`reason=expired`) — после входа
 * возврат на исходную страницу (`next`).
 */
export function SignInScreen() {
  const search = route.useSearch();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [view, setView] = useState<View>({ kind: 'form' });
  const [banner, setBanner] = useState<FormBanner>();
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, syncNow] = useNow(lockedUntil > 0 || view.kind === 'unverified');
  const locked = lockedUntil > now;

  const form = useForm<PanelSignInRequest>({
    resolver: zodResolver(PanelSignInRequest),
    defaultValues: { email: '', password: '' },
  });
  const password = useWatch({ control: form.control, name: 'password' });

  /** Вход завершён (сразу или после второго шага): `me` — в кэш, переход на исходную страницу. */
  const finish = async (me: PanelMe) => {
    queryClient.setQueryData(ME_QUERY_KEY, me);
    const next = search.next;
    if (next) await router.navigate({ href: publicHref(router.basepath, next) });
    else await router.navigate({ to: '/' });
  };

  const signIn = useMutation({
    mutationFn: (body: PanelSignInRequest) => api.signIn(body),
    meta: { ownsUnauthorized: true },
    onSuccess: async (result, body) => {
      if (result.state === 'verificationRequired') {
        setView({ kind: 'unverified', ...unverifiedState(result, body.email, syncNow()) });
        return;
      }
      if (result.state === 'totpRequired' || result.state === 'totpSetupRequired') {
        setView({
          kind: result.state === 'totpRequired' ? 'totp' : 'totpSetup',
          email: body.email.trim(),
          challenge: result.challenge,
        });
        return;
      }
      await finish(result.me);
    },
    onError: (error, body) => {
      const code = apiErrorOf(error)?.code;
      if (code === 'PANEL_ACCESS_DENIED') {
        setView({ kind: 'denied', email: body.email.trim() });
      } else if (code === 'RATE_LIMITED') {
        const details = RateLimitedDetails.safeParse(apiErrorOf(error)?.details);
        const seconds = details.success ? details.data.retryAfterSec : 60;
        setLockedUntil(syncNow() + seconds * 1000);
        setBanner(undefined);
      } else if (code === 'INVALID_CREDENTIALS') {
        setBanner('invalid');
      } else if (code === 'TOTP_UNAVAILABLE') {
        setBanner('totpUnavailable');
      } else {
        setBanner(isNetworkError(error) ? 'network' : 'unknown');
      }
    },
  });

  const submit = form.handleSubmit((body) => {
    setBanner(undefined);
    signIn.mutate(body);
  });

  const backToForm = () => {
    form.reset({ email: view.kind === 'form' ? '' : view.email, password: '' });
    setView({ kind: 'form' });
  };

  if (view.kind === 'totp' || view.kind === 'totpSetup') {
    const Step = view.kind === 'totp' ? TotpStep : TotpSetupStep;
    return (
      <Step
        challenge={view.challenge}
        onSignedIn={finish}
        onExpired={() => {
          backToForm();
          setBanner('totpExpired');
        }}
        onBack={() => {
          backToForm();
          setBanner(undefined);
        }}
      />
    );
  }

  if (view.kind === 'denied') {
    return (
      <AuthCard title={t('admin.signIn.deniedTitle')}>
        <p className="auth__lead t-body">
          {t('admin.signIn.deniedMessage', { email: view.email })}
        </p>
        <div className="auth__actions">
          <Button
            variant="primary"
            full
            onClick={() => {
              form.reset({ email: '', password: '' });
              setView({ kind: 'form' });
            }}
          >
            {t('admin.signIn.otherAccount')}
          </Button>
        </div>
      </AuthCard>
    );
  }

  if (view.kind === 'unverified') {
    return (
      <UnverifiedCard
        view={view}
        now={now}
        onResent={(seconds) => setView({ ...view, resendAt: syncNow() + seconds * 1000 })}
        onBack={backToForm}
      />
    );
  }

  const lockedMinutes = Math.max(1, Math.ceil((lockedUntil - now) / 60_000));
  const disabled = locked || signIn.isPending;
  return (
    <AuthCard title={t('admin.signIn.title')}>
      <p className="auth__lead t-body">{t('admin.signIn.lead')}</p>
      {locked ? (
        <Banner tone="error" role="alert" title={t('admin.signIn.lockedTitle')}>
          {t('admin.signIn.lockedMessage', { minutes: lockedMinutes })}
        </Banner>
      ) : banner === 'invalid' ? (
        <Banner tone="error" role="alert" title={t('admin.signIn.invalid')} />
      ) : banner === 'totpUnavailable' ? (
        <Banner tone="error" role="alert">
          {t('admin.totp.error.TOTP_UNAVAILABLE')}
        </Banner>
      ) : banner === 'totpExpired' ? (
        <Banner tone="warning" role="alert" title={t('admin.totp.expiredTitle')}>
          {t('admin.totp.expiredMessage')}
        </Banner>
      ) : banner ? (
        <Banner tone="error" role="alert">
          {t(banner === 'network' ? 'error.network' : 'error.unknown')}
        </Banner>
      ) : search.reason === 'expired' ? (
        <Banner tone="warning" title={t('admin.signIn.expiredTitle')}>
          {t('admin.signIn.expiredMessage')}
        </Banner>
      ) : null}
      <form noValidate onSubmit={(event) => void submit(event)}>
        <TextField
          label={t('admin.signIn.email')}
          type="email"
          autoComplete="username"
          disabled={locked}
          error={fieldErrorText(form.formState.errors.email?.message)}
          {...form.register('email')}
        />
        <TextField
          label={t('admin.signIn.password')}
          labelAside={
            <a className="link t-meta" href={FORGOT_PASSWORD_URL}>
              {t('admin.signIn.forgot')}
            </a>
          }
          type="password"
          autoComplete="current-password"
          disabled={locked}
          error={fieldErrorText(form.formState.errors.password?.message)}
          {...form.register('password')}
        />
        <Button
          type="submit"
          variant="primary"
          full
          className="auth__submit"
          disabled={disabled || password.length === 0}
          busy={signIn.isPending}
        >
          {t('admin.signIn.submit')}
        </Button>
      </form>
      <p className="auth__note t-meta">{t('admin.signIn.note')}</p>
    </AuthCard>
  );
}
