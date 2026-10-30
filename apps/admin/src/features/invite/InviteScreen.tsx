import { zodResolver } from '@hookform/resolvers/zod';
import { apiErrorOf, isNetworkError } from '@pokatim/api-client';
import { type PanelMe, PanelSignInRequest, RateLimitedDetails } from '@pokatim/contracts';
import { t } from '@pokatim/i18n';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';

import { api } from '../../api';
import { FORGOT_PASSWORD_URL, REGISTER_URL } from '../../config';
import { fieldErrorText } from '../../field-errors';
import { ME_QUERY_KEY } from '../../session/me';
import { AuthCard, Banner, Button, TextField } from '../../ui';
import { useNow } from '../../use-now';
import { TotpSetupStep, TotpStep } from '../sign-in/TotpSignInSteps';
import { UnverifiedCard, type UnverifiedState, unverifiedState } from '../sign-in/UnverifiedCard';

type View =
  | { kind: 'form' }
  | { kind: 'invalid'; detail?: string }
  | ({ kind: 'unverified' } & UnverifiedState)
  | { kind: 'totp' | 'totpSetup'; challenge: string };

type FormBanner = 'invalid' | 'alreadyMember' | 'network' | 'unknown' | undefined;

/** Токен из фрагмента ссылки письма (`#token=…`): фрагмент не уходит на сервер и в Referer. */
function tokenFromHash(): string | null {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const token = params.get('token');
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

/**
 * «Приглашение в команду» (ADR-0026, вне каркаса, как «Вход»): токен — из `#token=…`, сразу убирается из адреса.
 * Превью роли нет (роль и срок — в письме): общий текст и форма e-mail + пароль → «Принять и войти»; ответ — как у
 * входа (шаги 2FA, «E-mail не подтверждён»), затем «Обзор». Недействительная ссылка (нет токена, `410`) — карточка с
 * «Войти»; другой адрес — под полем e-mail.
 */
export function InviteScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [token] = useState(tokenFromHash);
  const [view, setView] = useState<View>(() => (token ? { kind: 'form' } : { kind: 'invalid' }));
  const [banner, setBanner] = useState<FormBanner>();
  const [lockedUntil, setLockedUntil] = useState(0);
  const [now, syncNow] = useNow(lockedUntil > 0 || view.kind === 'unverified');
  const locked = lockedUntil > now;

  useEffect(() => {
    // токен — капабилити: убрать из адреса (история, закладки, скриншоты)
    if (window.location.hash) {
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${window.location.search}`,
      );
    }
  }, []);

  const form = useForm<PanelSignInRequest>({
    resolver: zodResolver(PanelSignInRequest),
    defaultValues: { email: '', password: '' },
  });
  const password = useWatch({ control: form.control, name: 'password' });

  const finish = async (me: PanelMe) => {
    queryClient.setQueryData(ME_QUERY_KEY, me);
    await router.navigate({ to: '/' });
  };

  const accept = useMutation({
    mutationFn: (body: PanelSignInRequest) =>
      api.acceptInvitation({ token: token ?? '', email: body.email, password: body.password }),
    meta: { ownsUnauthorized: true },
    onSuccess: async (result, body) => {
      if (result.state === 'verificationRequired') {
        setView({ kind: 'unverified', ...unverifiedState(result, body.email, syncNow()) });
        return;
      }
      if (result.state === 'totpRequired' || result.state === 'totpSetupRequired') {
        setView({
          kind: result.state === 'totpRequired' ? 'totp' : 'totpSetup',
          challenge: result.challenge,
        });
        return;
      }
      await finish(result.me);
    },
    onError: (error) => {
      const code = apiErrorOf(error)?.code;
      if (code === 'PANEL_INVITATION_INVALID') {
        setView({ kind: 'invalid' });
      } else if (code === 'PANEL_INVITATION_EMAIL_MISMATCH') {
        form.setError('email', {
          type: 'server',
          message: t('admin.invite.error.PANEL_INVITATION_EMAIL_MISMATCH'),
        });
      } else if (code === 'PANEL_ALREADY_MEMBER') {
        setBanner('alreadyMember');
      } else if (code === 'RATE_LIMITED') {
        const details = RateLimitedDetails.safeParse(apiErrorOf(error)?.details);
        setLockedUntil(syncNow() + (details.success ? details.data.retryAfterSec : 60) * 1000);
        setBanner(undefined);
      } else if (code === 'INVALID_CREDENTIALS') {
        setBanner('invalid');
      } else if (isNetworkError(error)) {
        setBanner('network');
      } else {
        // приглашение могло быть уже принято, а вход — нет (RC-12): «Войти» и текст ошибки
        setView({ kind: 'invalid', detail: t('error.unknown') });
      }
    },
  });

  const backToForm = () => {
    form.reset({ email: form.getValues('email'), password: '' });
    setView({ kind: 'form' });
  };

  if (view.kind === 'totp' || view.kind === 'totpSetup') {
    const Step = view.kind === 'totp' ? TotpStep : TotpSetupStep;
    // приглашение уже принято: истёкший вызов — обычный вход с паролем
    const toSignIn = () => void router.navigate({ to: '/sign-in', search: { reason: 'expired' } });
    return (
      <Step challenge={view.challenge} onSignedIn={finish} onExpired={toSignIn} onBack={toSignIn} />
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

  if (view.kind === 'invalid') {
    return (
      <AuthCard title={t('admin.invite.invalidTitle')}>
        <p className="auth__lead t-body">{t('admin.invite.invalidMessage')}</p>
        {view.detail ? (
          <Banner tone="error" role="alert">
            {view.detail}
          </Banner>
        ) : null}
        <div className="auth__actions">
          <Button variant="primary" full onClick={() => void router.navigate({ to: '/sign-in' })}>
            {t('admin.invite.signIn')}
          </Button>
        </div>
      </AuthCard>
    );
  }

  const errors = form.formState.errors;
  const emailError =
    errors.email?.type === 'server' ? errors.email.message : fieldErrorText(errors.email?.message);
  const lockedMinutes = Math.max(1, Math.ceil((lockedUntil - now) / 60_000));
  return (
    <AuthCard title={t('admin.invite.title')}>
      <p className="auth__lead t-body">{t('admin.invite.lead')}</p>
      {locked ? (
        <Banner tone="error" role="alert" title={t('admin.signIn.lockedTitle')}>
          {t('admin.signIn.lockedMessage', { minutes: lockedMinutes })}
        </Banner>
      ) : banner === 'invalid' ? (
        <Banner tone="error" role="alert" title={t('admin.signIn.invalid')} />
      ) : banner === 'alreadyMember' ? (
        <Banner
          tone="warning"
          role="alert"
          actions={
            <Button size="sm" onClick={() => void router.navigate({ to: '/sign-in' })}>
              {t('admin.invite.signIn')}
            </Button>
          }
        >
          {t('admin.invite.error.PANEL_ALREADY_MEMBER')}
        </Banner>
      ) : banner ? (
        <Banner tone="error" role="alert">
          {t(banner === 'network' ? 'error.network' : 'error.unknown')}
        </Banner>
      ) : null}
      <form
        noValidate
        onSubmit={(event) =>
          void form.handleSubmit((body) => {
            setBanner(undefined);
            accept.mutate(body);
          })(event)
        }
      >
        <TextField
          label={t('admin.signIn.email')}
          type="email"
          autoComplete="username"
          disabled={locked}
          error={emailError}
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
          error={fieldErrorText(errors.password?.message)}
          {...form.register('password')}
        />
        <Button
          type="submit"
          variant="primary"
          full
          className="auth__submit"
          disabled={locked || accept.isPending || password.length === 0}
          busy={accept.isPending}
        >
          {t('admin.invite.submit')}
        </Button>
      </form>
      <p className="auth__note t-meta">
        {t('admin.invite.noAccount')}{' '}
        <a className="link" href={REGISTER_URL}>
          {t('admin.invite.register')}
        </a>
      </p>
    </AuthCard>
  );
}
