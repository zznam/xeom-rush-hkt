import { useEffect, useState } from 'react';
import { type AdminStaff, type CityReport } from '@xeom-rush/shared';
import { api, setCsrf, useResource } from './api';
import CityPanel from './CityPanel';
import Administration from './Administration';

export default function App() {
  const [staff, setStaff] = useState<AdminStaff | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    void api<{ staff: AdminStaff; csrf: string }>('me', 'GET', undefined, controller.signal)
      .then((me) => {
        if (!controller.signal.aborted) {
          setCsrf(me.csrf);
          setStaff(me.staff);
          setLoading(false);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          if (error.status !== 401) setError(error.message);
          setLoading(false);
        }
      });
    return () => controller.abort();
  }, []);
  if (loading)
    return (
      <main className='login'>
        <p role='status'>Opening the city desk…</p>
      </main>
    );
  if (!staff)
    return (
      <main className='login'>
        <div className='login-card'>
          <span className='brand-mark'>XÔ</span>
          <span className='eyebrow'>XE ÔM RUSH / GAME MASTER</span>
          <h1>
            A good city
            <br />
            needs a good crew.
          </h1>
          <p>Welcome to City Desk. Tune the streets, look after your drivers, and keep the city moving.</p>
          {error && <p role='alert'>{error}</p>}
          <a className='button primary' href='/api/admin/auth/login'>
            Continue with GitHub ↗
          </a>
          <small>Access is limited to approved game staff.</small>
        </div>
        <div className='login-art' aria-hidden='true'>
          <span>
            SAIGON
            <br />
            CITY
            <br />
            DESK.
          </span>
          <div className='road road-one' />
          <div className='road road-two' />
          <div className='road road-three' />
          <i className='map-dot one' />
          <i className='map-dot two' />
          <i className='map-dot three' />
        </div>
      </main>
    );
  return (
    <Desk
      staff={staff}
      onLogout={() => {
        setStaff(null);
        setCsrf('');
      }}
    />
  );
}
function Desk({ staff, onLogout }: { staff: AdminStaff; onLogout(): void }) {
  const cities = useResource<(CityReport & { key: string })[]>('cities', 5000);
  const [selected, setSelected] = useState('');
  const [deployment, setDeployment] = useState('');
  const [region, setRegion] = useState('');
  const [page, setPage] = useState('Cities');
  const [error, setError] = useState('');
  const deploymentIds = [...new Set(cities.data?.map((city) => city.ref.deployment) ?? [])];
  const regionIds = [
    ...new Set(
      cities.data?.filter((city) => !deployment || city.ref.deployment === deployment).map((city) => city.ref.region) ??
        [],
    ),
  ];
  const filtered =
    cities.data?.filter(
      (city) => (!deployment || city.ref.deployment === deployment) && (!region || city.ref.region === region),
    ) ?? [];
  const active = filtered.find((city) => city.key === selected) ?? filtered[0];
  return (
    <div className='desk'>
      <aside className='sidebar'>
        <a className='brand' href='/admin/'>
          <span className='brand-mark'>XÔ</span>
          <span>
            CITY DESK<small>Xe Ôm Rush</small>
          </span>
        </a>
        <span className='sidebar-label'>YOUR WORKSPACE</span>
        <nav aria-label='Main navigation'>
          {['Cities', ...(staff.role === 'owner' ? ['Staff', 'Deployments', 'Audit'] : [])].map((item) => (
            <button key={item} aria-current={page === item ? 'page' : undefined} onClick={() => setPage(item)}>
              {item === 'Cities' ? '◈' : item === 'Staff' ? '◇' : '○'} <span>{item}</span>
            </button>
          ))}
        </nav>
        <div className='sidebar-bottom'>
          <span className='avatar'>{staff.login.slice(0, 1)}</span>
          <div>
            <strong>{staff.login}</strong>
            <small>{staff.role === 'gm' ? 'Game Master' : staff.role}</small>
          </div>
          <button
            aria-label='Sign out'
            onClick={() => {
              void api('auth/logout', 'POST')
                .then(onLogout)
                .catch((e) => setError(e.message));
            }}
          >
            ↪
          </button>
        </div>
      </aside>
      <main className='content'>
        <header className='topbar'>
          <span>OPERATIONS / {page.toUpperCase()}</span>
          <span className='muted'>A little care. A better city.</span>
        </header>
        {error && (
          <div role='alert' className='notice'>
            {error}
          </div>
        )}
        {page === 'Cities' ? (
          <>
            <div className='selectors'>
              <label className='field'>
                <span>Deployment</span>
                <select
                  value={deployment}
                  onChange={(e) => {
                    setDeployment(e.target.value);
                    setRegion('');
                    setSelected('');
                  }}
                >
                  <option value=''>All deployments</option>
                  {deploymentIds.map((id) => (
                    <option key={id}>{id}</option>
                  ))}
                </select>
              </label>
              <label className='field'>
                <span>Region</span>
                <select
                  value={region}
                  onChange={(e) => {
                    setRegion(e.target.value);
                    setSelected('');
                  }}
                >
                  <option value=''>All regions</option>
                  {regionIds.map((id) => (
                    <option key={id}>{id}</option>
                  ))}
                </select>
              </label>
              <label className='field'>
                <span>City</span>
                <select value={active?.key ?? ''} onChange={(e) => setSelected(e.target.value)}>
                  {filtered.map((city) => (
                    <option key={city.key} value={city.key}>
                      {city.ref.room} · {city.ref.runtimeId.slice(0, 6)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {cities.error && (
              <div className='notice' role='alert'>
                {cities.error} <a href='/admin/'>Reload / sign in</a>
              </div>
            )}
            {active ? (
              <CityPanel key={active.key} cityKey={active.key} staff={staff} />
            ) : (
              <section className='card empty'>
                <span className='eyebrow'>YOUR CITY WILL APPEAR HERE</span>
                <h1>Ready when the streets are.</h1>
                <p>
                  {cities.data
                    ? 'No game servers have reported yet. Register a deployment and configure its worker connection to bring a city online.'
                    : 'Loading your cities…'}
                </p>
              </section>
            )}
          </>
        ) : (
          <Administration key={page} section={page as 'Staff' | 'Deployments' | 'Audit'} />
        )}
      </main>
    </div>
  );
}
