import { useState } from 'react';
import {
  validateCityConfig,
  type AdminCommand,
  type AdminPlayer,
  type AdminStaff,
  type BanRecord,
  type CityConfig,
  type CityReport,
  type CommandAction,
} from '@xeom-rush/shared';
import { api, useResource } from './api';
import ConfigEditor from './ConfigEditor';
import Dialog from './Dialog';

type CityDetail = {
  city: CityReport;
  config: { revision: number; config: CityConfig; pending?: string };
  players: { players: AdminPlayer[]; at: number; runtimeId: string } | null;
  map: { map: CityReport['map']; at: number; runtimeId: string } | null;
  commands: AdminCommand[];
};
type Preset = { id: string; name: string; config: CityConfig; version: string };
function differences(before: unknown, after: unknown, prefix = ''): string[] {
  if (before && after && typeof before === 'object' && typeof after === 'object')
    return Object.keys(after).flatMap((key) =>
      differences(
        (before as Record<string, unknown>)[key],
        (after as Record<string, unknown>)[key],
        prefix ? `${prefix}.${key}` : key,
      ),
    );
  return before === after ? [] : [`${prefix}: ${String(before)} → ${String(after)}`];
}
export default function CityPanel({ cityKey, staff }: { cityKey: string; staff: AdminStaff }) {
  const resource = useResource<CityDetail>(`cities/${encodeURIComponent(cityKey)}`, 2000);
  if (!resource.data)
    return (
      <section className='card'>
        <p role='status'>{resource.error || 'Connecting to the city…'}</p>
      </section>
    );
  return (
    <CityEditor
      initial={resource.data}
      latest={resource.data}
      cityKey={cityKey}
      staff={staff}
      error={resource.error}
      refresh={resource.refresh}
    />
  );
}
function CityEditor({
  initial,
  latest,
  cityKey,
  staff,
  error,
  refresh,
}: {
  initial: CityDetail;
  latest: CityDetail;
  cityKey: string;
  staff: AdminStaff;
  error: string;
  refresh(): void;
}) {
  const [tab, setTab] = useState('Overview');
  const [draft, setDraft] = useState(() => structuredClone(initial.config.config));
  const [base, setBase] = useState(() => ({ revision: initial.config.revision, config: initial.config.config }));
  const [review, setReview] = useState<CommandAction | null>(null);
  const [reviewId, setReviewId] = useState('');
  const [reviewTarget, setReviewTarget] = useState({ runtimeId: '', revision: 0 });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [moderate, setModerate] = useState<AdminPlayer | null>(null);
  const [reason, setReason] = useState('');
  const [duration, setDuration] = useState('86400000');
  const [presetName, setPresetName] = useState('');
  const presets = useResource<Preset[]>('presets');
  const bans = useResource<(BanRecord & { version: string })[]>(
    `bans?deployment=${encodeURIComponent(latest.city.ref.deployment)}`,
    10000,
  );
  const stale = Date.now() - latest.city.lastSeen > 15000;
  const changed = differences(base.config, draft);
  const canTune = staff.role !== 'moderator';
  const players = latest.players?.runtimeId === latest.city.ref.runtimeId ? latest.players.players : [];
  const propose = (action: CommandAction) => {
    setSubmittedId(null);
    setMessage('');
    setReview(action);
    setReviewId(crypto.randomUUID());
    setReviewTarget({
      runtimeId: latest.city.ref.runtimeId,
      revision: action.type === 'configure' ? base.revision : latest.config.revision,
    });
  };
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await work();
      refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Operation failed');
    } finally {
      setBusy(false);
    }
  };
  const submit = () =>
    run(async () => {
      if (!review) return;
      const command = await api<AdminCommand>(`cities/${encodeURIComponent(cityKey)}/commands`, 'POST', {
        id: reviewId,
        runtimeId: reviewTarget.runtimeId,
        expectedRevision: reviewTarget.revision,
        action: review,
      });
      setSubmittedId(command.id);
      setMessage(`Request ${command.id.slice(0, 8)} accepted. Waiting for the city to confirm application.`);
      setReview(null);
    });
  const createBan = () =>
    run(async () => {
      if (!moderate?.guestId) return;
      const existing = bans.data?.find((ban) => ban.guestId === moderate.guestId);
      await api(`bans/${latest.city.ref.deployment}/${moderate.guestId}`, 'PUT', {
        reason,
        expiresAt: duration === 'permanent' ? null : Date.now() + Number(duration),
        version: existing?.version ?? null,
      });
      setModerate(null);
      setMessage('Ban saved. Connected cities will enforce it on their next control update.');
      bans.refresh();
    });
  const reload = () => {
    setDraft(structuredClone(latest.config.config));
    setBase({ revision: latest.config.revision, config: latest.config.config });
    setMessage('Loaded the current saved configuration.');
  };
  const outcome = latest.commands.find((command) => command.id === submittedId);
  const statusMessage =
    outcome && outcome.status !== 'pending'
      ? `Request ${outcome.id.slice(0, 8)}: ${outcome.status}. ${outcome.result || ''}`
      : message;
  return (
    <>
      <section className='city-heading'>
        <div>
          <span className='eyebrow'>
            {latest.city.ref.deployment} / {latest.city.ref.region}
          </span>
          <h1>{latest.city.ref.room === 'local' ? 'Saigon City' : latest.city.ref.room}</h1>
          <p className='muted'>
            {latest.city.ref.persistent
              ? 'Settings survive city restarts'
              : 'Live instance · new instances use deployment defaults'}
          </p>
        </div>
        <span className={`pill ${stale ? 'red' : ''}`}>
          {stale ? 'Offline / stale' : latest.city.paused ? 'Paused' : 'Live city'}
        </span>
      </section>
      {(statusMessage || error) && (
        <div className='notice' role='status'>
          {error || statusMessage}
        </div>
      )}
      <div className='stats'>
        {[
          ['Human drivers', latest.city.humans],
          ['Active bots', latest.city.bots.current],
          ['Retiring bots', latest.city.bots.retiring],
          ['Tick duration', `${latest.city.tickMs.toFixed(1)} ms`],
        ].map(([label, value]) => (
          <div className='stat' key={label}>
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
      <nav className='tabs' aria-label='City sections'>
        {['Overview', ...(canTune ? ['Bots', 'Rules', 'Events'] : []), 'Players', 'History'].map((name) => (
          <button key={name} aria-current={tab === name ? 'page' : undefined} onClick={() => setTab(name)}>
            {name}
          </button>
        ))}
      </nav>
      <section className='card'>
        {tab === 'Overview' && (
          <>
            <div className='section-heading'>
              <div>
                <span className='eyebrow'>LIVE OBSERVER</span>
                <h2>Eyes on the streets.</h2>
              </div>
              <span className='pill'>{latest.city.config.mode}</span>
            </div>
            <div className='overview-grid'>
              <div>
                <svg
                  className='city-map'
                  viewBox='0 0 4000 4000'
                  role='img'
                  aria-label='Live city map: blue human drivers, orange bots, green passengers'
                >
                  <rect width='4000' height='4000' fill='#edf0e3' />
                  {[50, 450, 850, 1250, 1650, 2050, 2450, 2850, 3250, 3650].map((n) => (
                    <g key={n} stroke='#fff' strokeWidth='75'>
                      <path d={`M ${n} 0 V 4000`} />
                      <path d={`M 0 ${n} H 4000`} />
                    </g>
                  ))}
                  {(latest.map?.runtimeId === latest.city.ref.runtimeId ? latest.map?.map?.passengers : [])?.map(
                    (p, i) => (
                      <circle key={i} cx={p.x} cy={p.y} r='18' fill='#459764' />
                    ),
                  )}
                  {players.map((p) => (
                    <circle key={p.id} cx={p.x} cy={p.y} r={p.bot ? '22' : '32'} fill={p.bot ? '#d77443' : '#286dde'}>
                      <title>{p.username}</title>
                    </circle>
                  ))}
                </svg>
                <p className='muted'>
                  ● Blue: humans · Orange: bots · Green: passengers
                  <br />
                  Last report: {new Date(latest.city.lastSeen).toLocaleTimeString()} · Map:{' '}
                  {latest.map
                    ? `${new Date(latest.map.at).toLocaleTimeString()}${Date.now() - latest.map.at > 5000 ? ' (stale)' : ''}`
                    : 'waiting for sample'}
                </p>
              </div>
              <div className='overview-side'>
                <h3>City status</h3>
                <dl>
                  <dt>Admission</dt>
                  <dd>{latest.city.admissionsOpen ? 'Open' : 'Closed'}</dd>
                  <dt>Requested bots</dt>
                  <dd>{latest.city.bots.requested}</dd>
                  <dt>Applied revision</dt>
                  <dd>{latest.city.revision}</dd>
                  <dt>Saved revision</dt>
                  <dd>{latest.config.revision}</dd>
                </dl>
                <p>Observe the city here without taking a player seat.</p>
                {canTune && (
                  <div className='actions'>
                    <button
                      disabled={stale || busy}
                      onClick={() => propose({ type: latest.city.paused ? 'resume' : 'pause' })}
                    >
                      {latest.city.paused ? 'Resume city' : 'Pause city'}
                    </button>
                    <button
                      disabled={stale || busy}
                      onClick={() => propose({ type: latest.city.admissionsOpen ? 'close' : 'open' })}
                    >
                      {latest.city.admissionsOpen ? 'Close admissions' : 'Open admissions'}
                    </button>
                    <button className='danger' disabled={stale || busy} onClick={() => propose({ type: 'reset' })}>
                      Reset live city
                    </button>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
        {(tab === 'Bots' || tab === 'Rules') && (
          <>
            <ConfigEditor
              config={draft}
              onChange={setDraft}
              section={tab === 'Bots' ? 'bots' : 'rules'}
              disabled={!canTune || busy}
            />
            <div className='draft-bar'>
              <div>
                <strong>{changed.length} draft changes</strong>
                <small>
                  Based on revision {base.revision}
                  {base.revision !== latest.config.revision ? ' · newer revision available' : ''}
                </small>
              </div>
              <button onClick={reload}>Reload saved</button>
              <button
                className='primary'
                disabled={!changed.length || busy || stale || !!latest.config.pending}
                onClick={() => {
                  try {
                    propose({ type: 'configure', config: validateCityConfig(draft) });
                  } catch (error) {
                    setMessage((error as Error).message);
                  }
                }}
              >
                Review changes
              </button>
            </div>
            <div className='preset-row'>
              <label className='field'>
                <span>Load a preset into this draft</span>
                <select
                  defaultValue=''
                  onChange={(e) => {
                    const preset = presets.data?.find((p) => p.id === e.target.value);
                    if (preset) setDraft(structuredClone(preset.config));
                  }}
                >
                  <option value='' disabled>
                    Choose preset
                  </option>
                  {presets.data?.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className='field'>
                <span>Save draft as a new preset</span>
                <input
                  value={presetName}
                  maxLength={80}
                  placeholder='Evening practice'
                  onChange={(e) => setPresetName(e.target.value)}
                />
              </label>
              <button
                disabled={busy || !presetName.trim()}
                onClick={() =>
                  void run(async () => {
                    await api(`presets/${crypto.randomUUID()}`, 'PUT', {
                      name: presetName,
                      config: validateCityConfig(draft),
                      version: null,
                    });
                    setPresetName('');
                    presets.refresh();
                    setMessage('Preset saved.');
                  })
                }
              >
                Save preset
              </button>
            </div>
            {tab === 'Bots' && (
              <button className='danger' disabled={busy || stale} onClick={() => propose({ type: 'clear-bots' })}>
                Remove all bots immediately
              </button>
            )}
          </>
        )}
        {tab === 'Events' && (
          <>
            <span className='eyebrow'>CITY MOMENTS</span>
            <h2>Set the pace.</h2>
            <p className='muted'>
              Rush-hour actions use the city’s applied settings. Edit duration and rewards in Rules.
            </p>
            <div className='actions'>
              <button onClick={() => propose({ type: 'rush-start' })} disabled={busy || stale}>
                Start rush hour
              </button>
              <button onClick={() => propose({ type: 'rush-stop' })} disabled={busy || stale}>
                Stop rush hour
              </button>
            </div>
          </>
        )}
        {(tab === 'Events' || tab === 'Players') && (
          <form
            className='announcement'
            onSubmit={(e) => {
              e.preventDefault();
              propose({ type: 'announce', message: announcement });
            }}
          >
            <label className='field'>
              <span>City announcement · visible for one minute</span>
              <textarea
                required
                maxLength={240}
                value={announcement}
                onChange={(e) => setAnnouncement(e.target.value)}
                placeholder='A little heads-up for your drivers…'
              />
            </label>
            <button disabled={!announcement.trim() || busy || stale}>Review announcement</button>
          </form>
        )}
        {tab === 'Players' && (
          <>
            <h2>Drivers in this city</h2>
            <div className='table-scroll'>
              <table>
                <thead>
                  <tr>
                    <th>Driver</th>
                    <th>Type</th>
                    <th>Score</th>
                    <th>Trips</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {players.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {p.username}
                        <small>{p.connected ? 'Connected' : 'Reconnecting'}</small>
                      </td>
                      <td>{p.bot ? 'Bot' : 'Human'}</td>
                      <td>{p.score.toLocaleString()}đ</td>
                      <td>{p.deliveries}</td>
                      <td>
                        {!p.bot && (
                          <button
                            disabled={stale || busy}
                            onClick={() => {
                              setModerate(p);
                              setReason('');
                            }}
                          >
                            Moderate
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3>Deployment bans</h3>
            <p className='muted'>
              Bans follow this guest identity across the deployment’s regions. A fresh browser identity can bypass a
              guest ban.
            </p>
            {bans.error && <p role='alert'>{bans.error}</p>}
            {bans.data
              ?.filter((b) => !b.revokedAt)
              .map((ban) => (
                <div className='ban-row' key={ban.guestId}>
                  <div>
                    <strong>{ban.guestId}</strong>
                    <small>
                      {ban.reason} · {ban.expiresAt ? new Date(ban.expiresAt).toLocaleString() : 'Permanent'}
                    </small>
                  </div>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await api(`bans/${ban.deployment}/${ban.guestId}`, 'PUT', { ...ban, revoked: true });
                        bans.refresh();
                        setMessage('Ban revoked.');
                      })
                    }
                  >
                    Unban
                  </button>
                </div>
              ))}
          </>
        )}
        {tab === 'History' && (
          <>
            <h2>City command history</h2>
            <p className='muted'>
              Applied means the city acknowledged execution. Unknown means the controller could not establish the
              outcome.
            </p>
            {latest.commands.length === 0 ? (
              <p>No commands yet.</p>
            ) : (
              latest.commands.map((command) => (
                <div className='command-row' key={command.id}>
                  <div>
                    <strong>{command.action.type}</strong>
                    <small>
                      {new Date(command.createdAt).toLocaleString()} · {command.id.slice(0, 8)}
                    </small>
                    <p>{command.result}</p>
                  </div>
                  <span className={`pill ${command.status === 'applied' ? '' : 'amber'}`}>{command.status}</span>
                </div>
              ))
            )}
          </>
        )}
      </section>
      {review && (
        <Dialog title='Review city action' onCancel={() => !busy && setReview(null)}>
          <p>
            <strong>{review.type}</strong> · {latest.city.ref.room}
          </p>
          {review.type === 'configure' ? (
            <>
              <ul className='diff-list'>
                {differences(base.config, review.config).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {review.config.mode !== latest.city.config.mode && (
                <p className='notice'>
                  This changes progress mode. Players receive a 30-second countdown, eligible career progress is saved,
                  and current rides end.
                </p>
              )}
            </>
          ) : (
            <p>
              {review.type === 'reset'
                ? 'Players receive a 30-second countdown. Eligible progress is saved and all live rides end. Careers and bans remain.'
                : review.type === 'clear-bots'
                  ? 'All bots leave immediately, carried passengers are released, and the fixed bot count becomes zero.'
                  : review.type === 'announce'
                    ? review.message
                    : review.type === 'kick'
                      ? review.reason
                      : 'This changes the selected live city when its server acknowledges the request.'}
            </p>
          )}
          <div className='actions'>
            <button disabled={busy} onClick={() => setReview(null)}>
              Cancel
            </button>
            <button className='primary' disabled={busy} onClick={() => void submit()}>
              {busy ? 'Submitting…' : 'Apply to this city'}
            </button>
          </div>
          {message && <p role='alert'>{message}</p>}
        </Dialog>
      )}
      {moderate && (
        <Dialog title={`Moderate ${moderate.username}`} onCancel={() => !busy && setModerate(null)}>
          <label className='field'>
            <span>Reason shown to player</span>
            <textarea required value={reason} maxLength={240} onChange={(e) => setReason(e.target.value)} />
          </label>
          <label className='field'>
            <span>Ban duration</span>
            <select value={duration} onChange={(e) => setDuration(e.target.value)}>
              <option value='3600000'>1 hour</option>
              <option value='86400000'>24 hours</option>
              <option value='604800000'>7 days</option>
              <option value='permanent'>Permanent</option>
            </select>
          </label>
          <p>Applies to this guest identity throughout {latest.city.ref.deployment}.</p>
          <div className='actions'>
            <button
              disabled={busy || !reason.trim()}
              onClick={() => {
                propose({ type: 'kick', playerId: moderate.id, reason });
                setModerate(null);
              }}
            >
              Review kick
            </button>
            <button
              className='danger'
              disabled={busy || !reason.trim() || !moderate.guestId}
              onClick={() => void createBan()}
            >
              Confirm ban
            </button>
          </div>
          {message && <p role='alert'>{message}</p>}
        </Dialog>
      )}
    </>
  );
}
