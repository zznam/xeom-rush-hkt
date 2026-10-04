import {
  RULE_LIMITS,
  SKILL_LIMITS,
  STANDARD_RULES,
  type CityConfig,
  type GameRules,
  type BotLevel,
  type BotSkillProfile,
} from '@xeom-rush/shared';

const titles: Record<string, string> = {
  passengerLimit: 'Passenger population',
  fareMultiplier: 'Base fare multiplier',
  driverFine: 'Driver collision fine (đ)',
  redLightFine: 'Red-light fine (đ)',
  pedestrianFine: 'Pedestrian fine (đ)',
  speed: 'Vehicle speed',
  pedestriansPerCrosswalk: 'Pedestrians per crosswalk',
  greenSeconds: 'Green light (seconds)',
  yellowSeconds: 'Yellow light (seconds)',
  rushIntervalSeconds: 'Rush-hour interval (seconds)',
  rushDurationSeconds: 'Rush-hour duration (seconds)',
  rushFareMultiplier: 'Rush-hour fare multiplier',
  rushSpawnMultiplier: 'Rush-hour spawn multiplier',
  decisionMs: 'Decision delay (ms)',
  turnRate: 'Steering per tick (radians)',
  routeNoise: 'Route-choice variation',
  valueWeight: 'Fare efficiency preference',
  lawfulness: 'Lawfulness',
  aggression: 'Aggression',
  riskTolerance: 'Risk tolerance',
};
export function NumberField({
  label,
  value,
  limits,
  onChange,
}: {
  label: string;
  value: number;
  limits: [number, number, number];
  onChange(value: number): void;
}) {
  return (
    <label className='field'>
      <span>{label}</span>
      <input
        aria-label={label}
        type='number'
        min={limits[0]}
        max={limits[1]}
        step={limits[2]}
        value={Number.isFinite(value) ? value : ''}
        onChange={(event) => onChange(event.target.value === '' ? NaN : Number(event.target.value))}
      />
      <small>
        {limits[0]}–{limits[1]}
      </small>
    </label>
  );
}
export default function ConfigEditor({
  config,
  onChange,
  section,
  disabled,
}: {
  config: CityConfig;
  onChange(value: CityConfig): void;
  section: 'bots' | 'rules';
  disabled: boolean;
}) {
  const change = (fn: (draft: CityConfig) => void) => {
    const draft = structuredClone(config);
    fn(draft);
    onChange(draft);
  };
  const levels: BotLevel[] = ['easy', 'normal', 'hard'];
  return (
    <fieldset disabled={disabled} className='editor'>
      {section === 'bots' ? (
        <>
          <div className='section-heading'>
            <div>
              <span className='eyebrow'>CITY POPULATION</span>
              <h2>A lively city, on your terms.</h2>
            </div>
            <span className='pill'>50 bots maximum</span>
          </div>
          <p className='muted'>Bots make room for reconnecting drivers. Retiring bots finish their current delivery.</p>
          <div className='fields'>
            <label className='field'>
              <span>Population mode</span>
              <select
                value={config.bots.mode}
                onChange={(e) =>
                  change((d) => {
                    d.bots.mode = e.target.value as 'manual' | 'automatic';
                  })
                }
              >
                <option value='manual'>Fixed bot count</option>
                <option value='automatic'>Automatic fill</option>
              </select>
            </label>
            {config.bots.mode === 'manual' ? (
              <NumberField
                label='Bot count'
                value={config.bots.count}
                limits={[0, 50, 1]}
                onChange={(v) =>
                  change((d) => {
                    d.bots.count = v;
                  })
                }
              />
            ) : (
              <>
                <NumberField
                  label='Target total drivers'
                  value={config.bots.target}
                  limits={[0, 250, 1]}
                  onChange={(v) =>
                    change((d) => {
                      d.bots.target = v;
                    })
                  }
                />
                <NumberField
                  label='Minimum bots'
                  value={config.bots.minimum}
                  limits={[0, 50, 1]}
                  onChange={(v) =>
                    change((d) => {
                      d.bots.minimum = v;
                    })
                  }
                />
                <NumberField
                  label='Maximum bots'
                  value={config.bots.maximum}
                  limits={[0, 50, 1]}
                  onChange={(v) =>
                    change((d) => {
                      d.bots.maximum = v;
                    })
                  }
                />
              </>
            )}
          </div>
          <h3>Skill mix</h3>
          <p className='muted'>Choose a mix totaling 100%. Skill never grants extra speed or earnings.</p>
          <div className='fields'>
            {levels.map((level) => (
              <NumberField
                key={level}
                label={`${level[0].toUpperCase()}${level.slice(1)} (%)`}
                value={config.bots.mix[level]}
                limits={[0, 100, 1]}
                onChange={(v) =>
                  change((d) => {
                    d.bots.mix[level] = v;
                  })
                }
              />
            ))}
          </div>
          <details>
            <summary>Advanced skill and personality</summary>
            {levels.map((level) => (
              <section key={level}>
                <h3>{level.toUpperCase()}</h3>
                <div className='fields'>
                  {(Object.keys(SKILL_LIMITS) as (keyof BotSkillProfile)[]).map((key) => (
                    <NumberField
                      key={key}
                      label={`${level}: ${titles[key]}`}
                      value={config.bots.profiles[level][key]}
                      limits={SKILL_LIMITS[key]}
                      onChange={(v) =>
                        change((d) => {
                          d.bots.profiles[level][key] = v;
                        })
                      }
                    />
                  ))}
                </div>
              </section>
            ))}
          </details>
        </>
      ) : (
        <>
          <div className='section-heading'>
            <div>
              <span className='eyebrow'>RULES & ECONOMY</span>
              <h2>Make room for experiments.</h2>
            </div>
            <span className={`pill ${config.mode === 'sandbox' ? 'amber' : ''}`}>{config.mode}</span>
          </div>
          <label className='field'>
            <span>Progress mode</span>
            <select
              value={config.mode}
              onChange={(e) =>
                change((d) => {
                  d.mode = e.target.value as CityConfig['mode'];
                  if (d.mode === 'career') d.rules = structuredClone(STANDARD_RULES);
                })
              }
            >
              <option value='career'>Career · standard rules</option>
              <option value='sandbox'>Sandbox · session results only</option>
            </select>
          </label>
          <button
            type='button'
            onClick={() =>
              change((d) => {
                d.rules = structuredClone(STANDARD_RULES);
              })
            }
          >
            Restore standard rules in draft
          </button>
          <p className='muted'>
            Switching mode gives players 30 seconds, saves eligible progress, and ends their current rides. Career mode
            restores standard rules.
          </p>
          <fieldset disabled={config.mode === 'career'}>
            <div className='fields'>
              {(Object.keys(RULE_LIMITS) as (keyof typeof RULE_LIMITS)[]).map((key) => (
                <NumberField
                  key={key}
                  label={titles[key]}
                  value={config.rules[key]}
                  limits={RULE_LIMITS[key]}
                  onChange={(v) =>
                    change((d) => {
                      d.rules[key] = v;
                    })
                  }
                />
              ))}
            </div>
            <label className='check'>
              <input
                type='checkbox'
                checked={config.rules.driverCollisions}
                onChange={(e) =>
                  change((d) => {
                    d.rules.driverCollisions = e.target.checked;
                  })
                }
              />
              Driver-to-driver collisions
            </label>
            <h3>Passenger mix</h3>
            <div className='fields'>
              {(['regular', 'business', 'vip'] as (keyof GameRules['tiers'])[]).map((tier) => (
                <NumberField
                  key={tier}
                  label={`${tier.toUpperCase()} passengers (%)`}
                  value={config.rules.tiers[tier]}
                  limits={[0, 100, 1]}
                  onChange={(v) =>
                    change((d) => {
                      d.rules.tiers[tier] = v;
                    })
                  }
                />
              ))}
            </div>
          </fieldset>
        </>
      )}
    </fieldset>
  );
}
