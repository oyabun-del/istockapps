import { Page } from '../../components/layout/Page';
import { SupportButton } from '../../components/SupportButton';
import { Icon } from '../../components/ui/Icon';
import { ACTIVATION_STEPS, FAQ, type GuideStep } from '../../content/guide';
import { StepCard } from '../order/StepCard';

function SettingsPath({ path }: { path: readonly string[] }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-surface-container-low p-space-sm text-code-sm text-on-surface-variant">
      {path.map((item, index) => (
        <span key={item} className="flex items-center gap-space-xs" style={{ paddingLeft: `${index * 12}px` }}>
          <Icon
            name={index === 0 ? 'settings' : 'subdirectory_arrow_right'}
            className={`text-[14px] ${index === 0 ? 'text-primary' : 'text-outline'}`}
          />
          <span className={index === path.length - 1 ? 'font-semibold text-on-surface' : ''}>{item}</span>
        </span>
      ))}
    </div>
  );
}

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

export function GuidePage() {
  return (
    <Page subtitle="Инструкции">
      <div className="flex flex-col gap-space-lg">
        <section className="rounded-xl bg-surface-container-high p-space-lg">
          <h1 className="text-balance text-headline-lg tracking-tight text-on-surface">Как активировать приложение</h1>
          <p className="mt-space-sm text-body-sm text-on-surface-variant">
            Четыре шага, около пяти минут. Всё, что нужно, появится в вашем заказе после оплаты.
          </p>
        </section>

        <ol className="flex flex-col gap-space-md">
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
