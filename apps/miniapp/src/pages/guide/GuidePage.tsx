import { Page } from '../../components/layout/Page';
import { SupportButton } from '../../components/SupportButton';
import { Icon } from '../../components/ui/Icon';
import { SettingsPath } from '../../components/ui/SettingsPath';
import { ACTIVATION_STEPS, FAQ, SAFETY_RULES, type GuideStep } from '../../content/guide';
import { StepCard } from '../order/StepCard';

function GuideStepCard({ step, index, isLast }: { step: GuideStep; index: number; isLast: boolean }) {
  return (
    <StepCard index={index + 1} title={step.title} state="active" isLast={isLast}>
      <p className="text-body-sm text-on-surface-variant">{step.text}</p>
      {step.path && <SettingsPath path={step.path} />}
      {step.note && (
        <p className="flex items-start gap-1.5 rounded-lg bg-warning/10 p-space-sm text-body-sm text-warning">
          <Icon name="warning" className="mt-0.5 text-[16px]" />
          {step.note}
        </p>
      )}
    </StepCard>
  );
}

function SafetyRules() {
  return (
    <section aria-labelledby="rules-heading" className="flex flex-col gap-space-sm rounded-xl bg-warning/10 p-space-lg">
      <h2 id="rules-heading" className="flex items-center gap-space-xs text-headline-sm text-warning">
        <Icon name="warning" className="text-[20px]" />
        Важно до начала
      </h2>
      <ul className="flex flex-col gap-space-sm">
        {SAFETY_RULES.map((rule) => (
          <li key={rule} className="flex items-start gap-space-xs text-body-sm text-on-surface">
            <span aria-hidden="true" className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />
            {rule}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function GuidePage() {
  return (
    <Page subtitle="Инструкции">
      <div className="flex flex-col gap-space-lg">
        <section className="rounded-xl bg-surface-container-high p-space-lg">
          <h1 className="text-balance text-headline-lg tracking-tight text-on-surface">Как активировать приложение</h1>
          <p className="mt-space-sm text-body-sm text-on-surface-variant">
            Шесть шагов, около пяти минут. Логин, пароль и код появятся в вашем заказе после оплаты.
          </p>
        </section>

        <SafetyRules />

        <ol aria-label="Шаги активации" className="flex flex-col gap-space-md">
          {ACTIVATION_STEPS.map((step, index) => (
            <GuideStepCard key={step.title} step={step} index={index} isLast={index === ACTIVATION_STEPS.length - 1} />
          ))}
        </ol>

        <section aria-labelledby="faq-heading" className="flex flex-col gap-space-sm">
          <h2 id="faq-heading" className="px-space-xs text-headline-sm text-on-surface">
            Частые вопросы
          </h2>
          {FAQ.map((item) => (
            <details key={item.question} className="group rounded-xl bg-surface-container p-4">
              <summary className="flex cursor-pointer list-none items-center justify-between text-label-lg text-on-surface [&::-webkit-details-marker]:hidden">
                {item.question}
                <Icon name="expand_more" className="text-[20px] text-on-surface-variant transition-transform group-open:rotate-180" />
              </summary>
              <p className="mt-2 text-body-sm text-on-surface-variant">{item.answer}</p>
            </details>
          ))}
        </section>

        <SupportButton />
      </div>
    </Page>
  );
}
