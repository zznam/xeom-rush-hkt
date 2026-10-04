import { useState } from 'react';
import { type AdminRole, type AdminStaff, type CityConfig } from '@xeom-rush/shared';
import { api, useResource } from './api';
import Dialog from './Dialog';

type Deployment = { id: string; label: string; regions: string[]; defaults: CityConfig; version: string };
type Staff = AdminStaff & { version: string };
export default function Administration({ section }: { section: 'Staff' | 'Deployments' | 'Audit' }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('');
  const [id, setId] = useState('');
  const [login, setLogin] = useState('');
  const [role, setRole] = useState<AdminRole>('moderator');
  const [deploymentId, setDeploymentId] = useState('');
  const [regions, setRegions] = useState('local');
  const [label, setLabel] = useState('');
  const [credential, setCredential] = useState('');
  const [defaultsReview, setDefaultsReview] = useState<{
    deployment: Deployment;
    preset: { name: string; config: CityConfig };
  } | null>(null);
  const staff = useResource<Staff[]>('staff');
  const deployments = useResource<Deployment[]>('deployments');
  const presets = useResource<{ id: string; name: string; config: CityConfig }[]>('presets');
  const audit = useResource<
    { id: string; actor: string; action: string; target: string; at: number; detail: unknown }[]
  >(`audit?q=${encodeURIComponent(filter)}`);
  const work = async (operation: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await operation();
      setMessage('Saved.');
      staff.refresh();
      deployments.refresh();
      audit.refresh();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className='city-heading'>
        <div>
          <span className='eyebrow'>CONTROL ROOM</span>
          <h1>{section}</h1>
        </div>
      </div>
      {message && (
        <div className='notice' role='status'>
          {message}
        </div>
      )}
      <section className='card'>
        {section === 'Staff' && (
          <>
            <h2>Your city team</h2>
            <p className='muted'>
              Use the account’s numeric GitHub ID. Disabling staff immediately revokes access, including existing
              sessions.
            </p>
            {staff.error && <p role='alert'>{staff.error}</p>}
            {staff.data?.map((member) => (
              <div className='staff-row' key={member.id}>
                <div>
                  <strong>{member.login}</strong>
                  <small>
                    GitHub ID {member.id} · {member.role} · {member.disabled ? 'Disabled' : 'Active'}
                  </small>
                </div>
                <div className='actions'>
                  <button
                    onClick={() => {
                      setId(member.id);
                      setLogin(member.login);
                      setRole(member.role);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    disabled={busy}
                    onClick={() =>
                      void work(async () => {
                        await api(`staff/${member.id}`, 'PUT', { ...member, disabled: !member.disabled });
                      })
                    }
                  >
                    {member.disabled ? 'Enable' : 'Disable'}
                  </button>
                </div>
              </div>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void work(async () => {
                  await api(`staff/${id}`, 'PUT', {
                    login,
                    role,
                    disabled: false,
                    version: staff.data?.find((m) => m.id === id)?.version ?? null,
                  });
                  setId('');
                  setLogin('');
                });
              }}
            >
              <h3>Add or update staff</h3>
              <div className='fields'>
                <label className='field'>
                  <span>Numeric GitHub ID</span>
                  <input required pattern='[0-9]+' value={id} onChange={(e) => setId(e.target.value)} />
                </label>
                <label className='field'>
                  <span>Display label</span>
                  <input required maxLength={80} value={login} onChange={(e) => setLogin(e.target.value)} />
                </label>
                <label className='field'>
                  <span>Role</span>
                  <select value={role} onChange={(e) => setRole(e.target.value as AdminRole)}>
                    <option value='moderator'>Moderator</option>
                    <option value='gm'>Game Master</option>
                    <option value='owner'>Owner</option>
                  </select>
                </label>
              </div>
              <button className='primary' disabled={busy}>
                Save staff access
              </button>
            </form>
          </>
        )}
        {section === 'Deployments' && (
          <>
            <h2>Connected deployments</h2>
            <p className='muted'>
              Default changes affect newly started cities. Existing AWS room overrides keep their saved configuration.
            </p>
            {deployments.error && <p role='alert'>{deployments.error}</p>}
            {deployments.data?.map((deployment) => (
              <div className='deployment-row' key={deployment.id}>
                <h3>{deployment.label}</h3>
                <p>
                  {deployment.id} · {deployment.regions.join(', ')}
                </p>
                <label className='field'>
                  <span>Set defaults from a saved preset</span>
                  <select
                    disabled={busy}
                    value=''
                    onChange={(e) => {
                      const preset = presets.data?.find((p) => p.id === e.target.value);
                      if (preset) {
                        setMessage('');
                        setDefaultsReview({ deployment, preset });
                      }
                    }}
                  >
                    <option value='' disabled>
                      Select a preset to review
                    </option>
                    {presets.data?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <small>
                  Current default: {deployment.defaults.mode} · {deployment.defaults.bots.mode} bots
                </small>
              </div>
            ))}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void work(async () => {
                  const result = await api<{ token: string }>('deployments', 'POST', {
                    id: deploymentId,
                    label,
                    regions: regions.split(',').map((v) => v.trim()),
                  });
                  setCredential(result.token);
                });
              }}
            >
              <h3>Register a deployment</h3>
              <div className='fields'>
                <label className='field'>
                  <span>Deployment ID</span>
                  <input
                    required
                    pattern='[a-zA-Z0-9_-]+'
                    maxLength={80}
                    value={deploymentId}
                    onChange={(e) => setDeploymentId(e.target.value)}
                  />
                </label>
                <label className='field'>
                  <span>Display name</span>
                  <input required maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} />
                </label>
                <label className='field'>
                  <span>Allowed regions, comma separated</span>
                  <input required value={regions} onChange={(e) => setRegions(e.target.value)} />
                </label>
              </div>
              <button className='primary' disabled={busy}>
                Register deployment
              </button>
            </form>
            {credential && (
              <div className='notice'>
                <strong>Worker credential — shown once</strong>
                <p>Store this in the deployment’s ADMIN_WORKER_TOKEN secret.</p>
                <code className='credential'>{credential}</code>
                <button onClick={() => setCredential('')}>Dismiss credential</button>
              </div>
            )}
          </>
        )}
        {section === 'Audit' && (
          <>
            <h2>Action history</h2>
            <form
              className='search'
              onSubmit={(e) => {
                e.preventDefault();
                setFilter(query);
              }}
            >
              <label className='field'>
                <span>Search recent actions, actors, or cities</span>
                <input value={query} maxLength={100} onChange={(e) => setQuery(e.target.value)} />
              </label>
              <button>Search</button>
            </form>
            <p className='muted'>Showing up to 100 matches from the 500 most recent audit records.</p>
            {audit.error && <p role='alert'>{audit.error}</p>}
            {audit.data?.map((event) => (
              <div className='command-row' key={event.id}>
                <div>
                  <strong>{event.action}</strong>
                  <small>
                    {new Date(event.at).toLocaleString()} · GitHub {event.actor}
                  </small>
                  <p>{event.target}</p>
                  {event.detail != null && (
                    <details>
                      <summary>Details</summary>
                      <pre>{JSON.stringify(event.detail, null, 2)}</pre>
                    </details>
                  )}
                </div>
              </div>
            ))}
          </>
        )}
      </section>
      {defaultsReview && (
        <Dialog title='Review deployment defaults' onCancel={() => !busy && setDefaultsReview(null)}>
          <p>
            Apply <strong>{defaultsReview.preset.name}</strong> as the defaults for new cities in{' '}
            <strong>{defaultsReview.deployment.label}</strong>.
          </p>
          <p>Existing cities keep their current settings.</p>
          <pre className='config-preview'>{JSON.stringify(defaultsReview.preset.config, null, 2)}</pre>
          <div className='actions'>
            <button disabled={busy} onClick={() => setDefaultsReview(null)}>
              Cancel
            </button>
            <button
              className='primary'
              disabled={busy}
              onClick={() =>
                void work(async () => {
                  await api(`deployments/${defaultsReview.deployment.id}/defaults`, 'PUT', {
                    config: defaultsReview.preset.config,
                    version: defaultsReview.deployment.version,
                  });
                  setDefaultsReview(null);
                })
              }
            >
              Apply defaults
            </button>
          </div>
          {message && <p role='alert'>{message}</p>}
        </Dialog>
      )}
    </>
  );
}
