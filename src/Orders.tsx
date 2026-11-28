import {
  ArrowDownUp, ArrowLeft, ArrowUpRight, Ban, BookOpen, Check, ChevronRight,
  CircleAlert, ClipboardList, Clock3, Ellipsis, ImageOff, LayoutGrid, Minus, Plus,
  Search, Send, Sofa, UserRound, Users, X,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  availableQuantity, entries, isActiveOrder, isOrderServed, newId, orderAlerts, orderItems, orderStatus, orderStatusLabel, orderTitle, orderTotal, stockStatus,
  type Command, type Order, type OrderAlert, type OrderItem, type Product, type Session, type State,
} from './domain';
import './orders.css';

export type OrdersScreen =
  | { page: 'orders' }
  | { page: 'tables'; initialTab?: boolean }
  | { page: 'order'; orderId: string; from?: 'tables' | 'orders' }
  | { page: 'catalog'; orderId: string; guestId: string; categoryId?: string; from?: 'tables' | 'orders' };

type OrdersProps = {
  state: State;
  user: Session;
  execute: (command: Command) => Promise<unknown>;
  verifyServedRemoval?: () => Promise<void>;
  screen: OrdersScreen;
  navigate: (screen: OrdersScreen) => void;
  openQuick: () => void;
};

type ItemDetails = {
  quantity: number;
  sizeId?: string;
  optionIds: string[];
  customSyrup?: string;
  comment: string;
  guestId: string;
};

type SortOrder = 'recent' | 'waiting' | 'total' | 'label';

const sorts: Record<SortOrder, string> = {
  recent: 'Сначала новые',
  waiting: 'Сначала ожидающие',
  total: 'По сумме заказа',
  label: 'По названию',
};

const itemStatus: Record<OrderItem['status'], string> = {
  draft: 'Новая позиция',
  preparing: 'Готовится',
  ready: 'Готово к выдаче',
  served: 'Выдано',
  canceled: 'Отменено',
};
const pendingPriceLabel = 'Цена не указана';

const currency = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const compactTime = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' });
const formatCurrency = (value: number) => currency.format(value);
const isClosed = (order: Order) => !isActiveOrder(order);
const sortByRank = (a: { sort: number; name: string }, b: { sort: number; name: string }) =>
  a.sort - b.sort || a.name.localeCompare(b.name, 'ru', { numeric: true });

function elapsed(instant: number, now: number) {
  const minutes = Math.max(0, Math.floor((now - instant) / 60_000));
  if (minutes < 60) return minutes + ' мин';
  return Math.floor(minutes / 60) + ' ч ' + String(minutes % 60).padStart(2, '0') + ' мин';
}

const statusTones = {
  new: 'blue',
  preparing: 'white',
  ready: 'green',
  served: 'green',
  precheck: 'red',
  closed: 'muted',
  canceled: 'red',
} as const;

function orderAppearance(order: Order, alert?: OrderAlert) {
  const status = orderStatus(order);
  return {
    color: alert?.tone ?? statusTones[status],
    label: alert?.reason ?? orderStatusLabel[status],
  };
}

function useMinute() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const interval = window.setInterval(refresh, 15_000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
    };
  }, []);
  return now;
}

function OrderIconButton({ label, children, onClick, pressed }: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  pressed?: boolean;
}) {
  return <button type="button" className="icon-button order-icon" aria-label={label} aria-pressed={pressed} onClick={onClick}>{children}</button>;
}

function OrderHeader({ heading, caption, onBack, actions, centered = false }: {
  heading: string;
  caption?: ReactNode;
  onBack?: () => void;
  actions?: ReactNode;
  centered?: boolean;
}) {
  return (
    <header className={'order-header' + (centered ? ' order-header--centered' : '')}>
      {onBack && <OrderIconButton label="Назад" onClick={onBack}><ArrowLeft size={20} /></OrderIconButton>}
      <div className="order-header-title">
        <h1>{heading}</h1>
        {caption && <div className="order-header-caption">{caption}</div>}
      </div>
      {actions && <div className="order-header-actions">{actions}</div>}
    </header>
  );
}

function OrderEmpty({ children, icon = <ClipboardList size={25} /> }: { children: ReactNode; icon?: ReactNode }) {
  return <div className="order-empty">{icon}<div>{children}</div></div>;
}

function OrderSheet({ title, children, onClose, locked = false }: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  locked?: boolean;
}) {
  const titleId = useId();
  const surface = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  const lockedRef = useRef(locked);
  const closeTimer = useRef<number | null>(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => { lockedRef.current = locked; }, [locked]);

  const close = () => {
    if (lockedRef.current || closeTimer.current !== null) return;
    setClosing(true);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    closeTimer.current = window.setTimeout(() => closeRef.current(), reduced ? 0 : 190);
  };

  useEffect(() => {
    const dialog = surface.current;
    dialog?.showModal();
    const viewport = window.visualViewport;
    let lastHeight = viewport?.height ?? window.innerHeight;
    let scrollFrame = 0;
    const fitViewport = () => {
      if (!dialog || !viewport || viewport.scale !== 1) return;
      // Safari may resize only the visual viewport when the software keyboard opens.
      const obscured = Math.max(0, document.documentElement.clientHeight - viewport.height - viewport.offsetTop);
      dialog.style.setProperty('--order-viewport-height', viewport.height + 'px');
      dialog.style.setProperty('--order-viewport-offset', obscured + 'px');
      const input = document.activeElement;
      if (viewport.height < lastHeight - 80 && (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) && dialog.contains(input)) {
        scrollFrame = requestAnimationFrame(() => input.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
      }
      lastHeight = viewport.height;
    };
    fitViewport();
    viewport?.addEventListener('resize', fitViewport);
    viewport?.addEventListener('scroll', fitViewport);
    window.addEventListener('resize', fitViewport);
    return () => {
      viewport?.removeEventListener('resize', fitViewport);
      viewport?.removeEventListener('scroll', fitViewport);
      window.removeEventListener('resize', fitViewport);
      cancelAnimationFrame(scrollFrame);
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
      dialog?.close();
    };
  }, []);

  return (
    <dialog
      className={'order-sheet' + (closing ? ' order-sheet--closing' : '')}
      aria-labelledby={titleId}
      ref={surface}
      onCancel={(event) => { event.preventDefault(); close(); }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect();
        if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) close();
      }}
    >
      <div className="order-sheet-handle" aria-hidden="true" />
      <header className="order-sheet-heading">
        <h2 id={titleId}>{title}</h2>
        <OrderIconButton label="Закрыть" onClick={close}><X size={18} /></OrderIconButton>
      </header>
      {children}
    </dialog>
  );

}

function Stepper({ value, onChange, min = 1, max = 100, label, context = '' }: {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  label: string;
  context?: string;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const clamp = (next: number) => Math.max(min, Math.min(max, next));
  const update = (next: number) => {
    setEditing(null);
    onChange(clamp(next));
  };

  return (
    <div className="order-stepper">
      <button type="button" aria-label={context ? 'Убрать гостя' : 'Уменьшить количество'} disabled={value <= min} onClick={() => update(value - 1)}><Minus size={20} /></button>
      <input aria-label={label} type="text" inputMode="numeric" pattern="[0-9]*" maxLength={3}
        value={editing ?? String(value)}
        onChange={(event) => {
          const next = event.target.value.replace(/[^0-9]/g, '');
          setEditing(next);
          if (next) onChange(clamp(Number(next)));
        }}
        onBlur={() => setEditing(null)} />
      <button type="button" aria-label={context ? 'Добавить гостя' : 'Увеличить количество'} disabled={value >= max} onClick={() => update(value + 1)}><Plus size={20} /></button>
    </div>
  );
}

type Mutations = {
  busy: boolean;
  error: string;
  perform: (command: Command, authorize?: () => Promise<void>) => Promise<boolean>;
  clearError: () => void;
};

function useMutations(execute: OrdersProps['execute']): Mutations {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(false);
  const perform = async (command: Command, authorize?: () => Promise<void>) => {
    if (active.current) return false;
    active.current = true;
    setBusy(true);
    setError('');
    try {
      if (authorize) await authorize();
      await execute(command);
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Не удалось сохранить изменения');
      return false;
    } finally {
      active.current = false;
      setBusy(false);
    }
  };
  return { busy, error, perform, clearError: () => setError('') };
}

function FormError({ text }: { text: string }) {
  return text ? <p className="order-error" role="alert"><CircleAlert size={17} />{text}</p> : null;
}

export function Orders(props: OrdersProps) {
  const { screen, navigate, state } = props;
  const [scope, setScope] = useState<'mine' | 'all'>('mine');
  const [sort, setSort] = useState<SortOrder>('recent');
  const now = useMinute();
  const alerts = useMemo(() => new Map(orderAlerts(state, now).map((alert) => [alert.orderId, alert])), [state, now]);

  if (screen.page === 'orders') {
    return <OrderList {...props} scope={scope} setScope={setScope} sort={sort} setSort={setSort} alerts={alerts} />;
  }

  if (screen.page === 'tables') return <Tables {...props} initialTab={screen.initialTab} now={now} alerts={alerts} />;

  const order = state.orders[screen.orderId];
  if (!order) {
    return <main className="order-screen order-screen--full">
      <OrderHeader heading="Заказ" onBack={() => navigate({ page: 'orders' })} />
      <OrderEmpty>Заказ недоступен</OrderEmpty>
    </main>;
  }

  if (screen.page === 'catalog') return <Catalog key={order.id + '/' + screen.guestId} {...props} order={order} screen={screen} />;
  return <Editor key={order.id} {...props} order={order} from={screen.from} now={now} alert={alerts.get(order.id)} />;
}

function OrderList({ state, user, navigate, openQuick, scope, setScope, sort, setSort, alerts }: OrdersProps & {
  scope: 'mine' | 'all';
  setScope: (value: 'mine' | 'all') => void;
  sort: SortOrder;
  setSort: (value: SortOrder) => void;
  alerts: Map<string, OrderAlert>;
}) {
  const [sortOpen, setSortOpen] = useState(false);
  const grouped = useMemo(() => {
    const orders = entries(state.orders)
      .filter((order) => !isClosed(order) && (scope === 'all' || order.waiterId === user.userId))
      .sort((a, b) => {
        switch (sort) {
          case 'waiting': return a.createdAt - b.createdAt;
          case 'total': return orderTotal(b) - orderTotal(a);
          case 'label': return a.label.localeCompare(b.label, 'ru', { numeric: true });
          case 'recent': return b.createdAt - a.createdAt;
        }
      });
    const groups = new Map<string, Order[]>();
    for (const order of orders) {
      const key = order.hallId ?? 'tabs';
      const group = groups.get(key) ?? [];
      group.push(order);
      groups.set(key, group);
    }
    const halls = entries(state.halls).sort(sortByRank);
    return [...groups.entries()]
      .sort(([left], [right]) => {
        const hallIndex = (id: string) => {
          const index = halls.findIndex((hall) => hall.id === id);
          return index === -1 ? Infinity : index;
        };
        if (left === 'tabs') return 1;
        if (right === 'tabs') return -1;
        return hallIndex(left) - hallIndex(right);
      })
      .map(([id, orders]) => ({ id, label: id === 'tabs' ? 'Именные табы' : state.halls[id]?.name ?? 'Зал', orders }));
  }, [state.orders, state.halls, scope, user.userId, sort]);

  return (
    <main className="order-screen" aria-label="Раздел заказов">
      <OrderHeader heading="Заказы" actions={<>
        <OrderIconButton label="Сортировать заказы" onClick={() => setSortOpen(true)}><ArrowDownUp size={18} /></OrderIconButton>
        <OrderIconButton label="Быстрые действия" onClick={openQuick}><Ellipsis size={22} /></OrderIconButton>
      </>} />
      <div className="order-segments" role="group" aria-label="Заказы по официанту">
        <button type="button" aria-pressed={scope === 'mine'} onClick={() => setScope('mine')}>Мои</button>
        <button type="button" aria-pressed={scope === 'all'} onClick={() => setScope('all')}>Все</button>
      </div>
      {grouped.length ? grouped.map((group) => (
        <section className="order-group" key={group.id} aria-labelledby={'group-' + group.id}>
          <h2 id={'group-' + group.id}>{group.label}</h2>
          <div className="order-grid">
            {group.orders.map((order) => (
              <OrderCard key={order.id} state={state} order={order} showWaiter={scope === 'all'} alert={alerts.get(order.id)}
                open={() => navigate({ page: 'order', orderId: order.id, from: 'orders' })} />
            ))}
          </div>
        </section>
      )) : <OrderEmpty>Активных заказов пока нет</OrderEmpty>}
      <button type="button" aria-label="Новый заказ" className="order-fab" onClick={() => navigate({ page: 'tables' })}><Plus size={28} /></button>
      {sortOpen && <OrderSheet title="Сортировка заказов" onClose={() => setSortOpen(false)}>
        <div className="order-sheet-list">
          {(Object.entries(sorts) as Array<[SortOrder, string]>).map(([value, label]) =>
            <button type="button" className="order-sheet-row" key={value} aria-pressed={sort === value} onClick={() => { setSort(value); setSortOpen(false); }}>
              {label}{sort === value && <Check size={19} className="order-blue" />}
            </button>)}
        </div>
      </OrderSheet>}
    </main>
  );
}

function OrderCard({ state, order, alert, showWaiter, open }: {
  state: State;
  order: Order;
  alert?: OrderAlert;
  showWaiter: boolean;
  open: () => void;
}) {
  const items = orderItems(order);
  const appearance = orderAppearance(order, alert);
  return (
    <button type="button" className={'order-card tone-' + appearance.color} onClick={open}>
      <div className="order-card-heading"><strong>{orderTitle(order)}</strong><time dateTime={new Date(order.createdAt).toISOString()}>{compactTime.format(order.createdAt)}</time></div>
      <div className="order-card-status">{appearance.label}</div>
      {showWaiter && <div className="order-card-waiter"><UserRound size={13} />{state.users[order.waiterId]?.name ?? 'Официант'}</div>}
      <ul className="order-card-items">
        {items.slice(0, 3).map((item) => <li key={item.id}>{item.name}{item.quantity > 1 ? ' × ' + item.quantity : ''}</li>)}
        {items.length > 3 && <li className="order-card-extra">Ещё {items.length - 3}</li>}
        {!items.length && <li className="order-card-extra">Позиций нет</li>}
      </ul>
      <span className="order-card-footer">
        <span className="order-card-guests" aria-label={'Гостей ' + order.guestIds.length}><Users size={15} />{order.guestIds.length}</span>
        <strong>{items.some(item => item.pricePending) ? 'От ' : ''}{formatCurrency(orderTotal(order))}</strong>
      </span>
    </button>
  );
}

function Tables({ state, user, execute, navigate, now, initialTab, alerts }: OrdersProps & { now: number; initialTab?: boolean; alerts: Map<string, OrderAlert> }) {
  const halls = entries(state.halls).filter((hall) => !hall.archived).sort(sortByRank);
  const [selectedHall, setSelectedHall] = useState(halls[0]?.id ?? '');
  const [selectedTable, setSelectedTable] = useState<string | null>(null);
  const [ownOnly, setOwnOnly] = useState(false);
  const [tabOpen, setTabOpen] = useState(Boolean(initialTab));
  const [tabName, setTabName] = useState('');
  const [people, setPeople] = useState(1);
  const mutation = useMutations(execute);
  const hallId = halls.some((hall) => hall.id === selectedHall) ? selectedHall : halls[0]?.id;
  const activeOrders = useMemo(() => entries(state.orders).filter((order) => order.tableId && !isClosed(order)), [state.orders]);
  const table = selectedTable ? state.tables[selectedTable] : undefined;
  const activeOrder = table ? activeOrders.find((order) => order.tableId === table.id) : undefined;
  const tables = entries(state.tables).filter((entry) => {
    if (entry.archived || entry.hallId !== hallId) return false;
    if (!ownOnly) return true;
    return entry.waiterId === user.userId || activeOrders.some((order) => order.tableId === entry.id && order.waiterId === user.userId);
  }).sort(sortByRank);

  const close = () => {
    setSelectedTable(null);
    setTabOpen(false);
    mutation.clearError();
  };

  const create = async () => {
    const orderId = newId();
    const command: Command = table
      ? { type: 'createOrder', orderId, tableId: table.id, guestCount: people }
      : { type: 'createOrder', orderId, tabName: tabName.trim(), guestCount: people };
    if (await mutation.perform(command)) navigate({ page: 'order', orderId, from: 'tables' });
  };

  return (
    <main className="order-screen order-screen--full table-screen">
      <OrderHeader heading="Выберите стол" centered onBack={() => navigate({ page: 'orders' })}
        actions={<OrderIconButton label="Мои столы" pressed={ownOnly} onClick={() => setOwnOnly(!ownOnly)}><UserRound size={18} /></OrderIconButton>} />
      {halls.length > 0 && <div className="order-segments table-halls" role="group" aria-label="Залы">
        {halls.map((hall) => <button key={hall.id} type="button" aria-pressed={hallId === hall.id} onClick={() => setSelectedHall(hall.id)}>{hall.name}</button>)}
      </div>}
      {tables.length ? <div className="table-grid">
        {tables.map((entry) => {
          const order = activeOrders.find((candidate) => candidate.tableId === entry.id);
          const appearance = order ? orderAppearance(order, alerts.get(order.id)) : undefined;
          return <button type="button" className={appearance ? 'table-tile tone-' + appearance.color : 'table-tile'}
            key={entry.id} aria-label={order ? 'Стол ' + entry.name + ', ' + appearance?.label : entry.name}
            onClick={() => { setPeople(1); setSelectedTable(entry.id); }}>
            {entry.name}
          </button>;
        })}
      </div> : <OrderEmpty icon={<LayoutGrid size={26} />}>{ownOnly ? 'У вас нет столов в этом зале' : 'В зале пока нет столов'}</OrderEmpty>}
      <div className="order-bottom table-bottom">
        <button type="button" className="primary" onClick={() => { setTabName(''); setPeople(1); setTabOpen(true); }}><Plus size={20} />Создать таб</button>
      </div>
      {table && <OrderSheet title={activeOrder ? orderTitle(activeOrder) : 'Количество гостей'} onClose={close} locked={mutation.busy}>
        {activeOrder ? <div className="order-sheet-content">
          <div className="order-occupied-summary">
            <span><Users size={19} />{activeOrder.guestIds.length} гост.</span>
            <span><Clock3 size={19} />{elapsed(activeOrder.createdAt, now)}</span>
            <span>{formatCurrency(orderTotal(activeOrder))}</span>
          </div>
          <button type="button" className="primary" onClick={() => navigate({ page: 'order', orderId: activeOrder.id, from: 'tables' })}>
            {activeOrder.waiterId === user.userId ? 'Дозаказ в существующий заказ' : 'Открыть существующий заказ'}
          </button>
        </div> : <form className="order-sheet-content" onSubmit={(event) => { event.preventDefault(); void create(); }}>
          <p className="order-sheet-caption">Стол {table.name} · {table.capacity} мест</p>
          <Stepper value={people} onChange={setPeople} label="Количество гостей" context="guests" />
          <FormError text={mutation.error} />
          <button type="submit" className="primary" disabled={mutation.busy}>Создать заказ</button>
        </form>}
      </OrderSheet>}
      {tabOpen && <OrderSheet title="Новый таб" onClose={close} locked={mutation.busy}>
        <form className="order-sheet-content" onSubmit={(event) => { event.preventDefault(); void create(); }}>
          <label className="order-field">Название таба<input type="text" placeholder="Например, Анна" value={tabName} onChange={(event) => setTabName(event.target.value)} maxLength={80} required /></label>
          <div className="order-field"><span>Количество гостей</span><Stepper value={people} onChange={setPeople} label="Количество гостей" context="guests" /></div>
          <FormError text={mutation.error} />
          <button type="submit" className="primary" disabled={mutation.busy || !tabName.trim()}>Создать заказ</button>
        </form>
      </OrderSheet>}
    </main>
  );
}

function FreeTables({ state, order, busy, onChoose }: {
  state: State; order: Order; busy: boolean; onChoose: (tableId: string) => void;
}) {
  const occupied = new Set(entries(state.orders).filter(isActiveOrder).map(entry => entry.tableId));
  const halls = entries(state.halls).filter(hall => !hall.archived).sort(sortByRank);
  const currentHall = halls.find(hall => hall.id === order.hallId);
  const orderedHalls = currentHall ? [currentHall, ...halls.filter(hall => hall.id !== currentHall.id)] : halls;
  const freeTables = entries(state.tables).filter(table => !table.archived && !occupied.has(table.id)).sort(sortByRank);
  const groups = orderedHalls.map(hall => ({ hall, tables: freeTables.filter(table => table.hallId === hall.id) }))
    .filter(group => group.tables.length > 0);

  if (!groups.length) return <OrderEmpty icon={<Sofa size={25} />}>Сейчас нет свободных столов</OrderEmpty>;

  return <>
    <p className="order-sheet-caption">Сейчас {orderTitle(order)}. Выберите свободный стол.</p>
    {groups.map(({ hall, tables }) => <section key={hall.id} aria-label={hall.name}>
      {halls.length > 1 && <div className="order-sheet-caption">{hall.name}</div>}
      <div className="table-grid">
        {tables.map(table => <button key={table.id} type="button" className="table-tile" disabled={busy}
          onClick={() => onChoose(table.id)}>{table.name}</button>)}
      </div>
    </section>)}
  </>;
}

function Editor({ state, user, execute, verifyServedRemoval, navigate, order, from, now, alert }: OrdersProps & {
  order: Order;
  from?: 'tables' | 'orders';
  now: number;
  alert?: OrderAlert;
}) {
  const [selectedItem, setSelectedItem] = useState<string | null>(null);
  const [menu, setMenu] = useState<'options' | 'cancel' | 'checkout' | 'move' | null>(null);
  const tap = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  useEffect(() => () => { if (tap.current) clearTimeout(tap.current.timer); }, []);
  const mutation = useMutations(execute);
  const items = orderItems(order);
  const own = user.userId === order.waiterId || user.role === 'admin';
  const editable = own && !isClosed(order);
  const selected = selectedItem ? order.items[selectedItem] : undefined;
  const currentStatus = orderAppearance(order, alert);
  const drafts = items.filter((item) => item.status === 'draft');
  const ready = items.filter((item) => item.status === 'ready');
  const pending = items.filter((item) => item.pricePending);
  const allServed = isOrderServed(order);
  const canPrecheck = items.length > 0 && drafts.length === 0 && !pending.length;
  const canCheckout = !pending.length && (allServed || order.precheckAt !== undefined);
  const unsent = items.every(item => item.status === 'draft');
  const cancelLabel = unsent ? 'Удалить заказ' : 'Отменить заказ';
  const hasGuests = order.guestIds.length > 0;
  const catalog = (guestId: string) => navigate({ page: 'catalog', guestId, orderId: order.id, from });
  const closeMenu = () => { setMenu(null); setSelectedItem(null); mutation.clearError(); };

  let action: { label: string; execute: () => void; icon: ReactNode } | undefined;
  if (editable) {
    if (canCheckout) {
      action = { label: 'К расчёту', execute: () => { mutation.clearError(); setMenu('checkout'); }, icon: <Check size={19} /> };
    } else if (drafts.length) {
      action = { label: 'Отправить на кухню', execute: () => { void mutation.perform({ type: 'sendOrder', orderId: order.id }); }, icon: <Send size={18} /> };
    } else if (hasGuests && !order.precheckAt && !allServed) {
      action = { label: items.length ? 'Добавить дозаказ' : 'Добавить позиции', execute: () => catalog(order.guestIds[0]), icon: <Plus size={21} /> };
    }
  }

  const itemAction = async (type: 'cancelItem' | 'readyItem' | 'serveItem' | 'unreadyItem', itemId: string) => {
    if (tap.current) clearTimeout(tap.current.timer);
    tap.current = null;
    if (await mutation.perform({ type, orderId: order.id, itemId })) {
      if (type !== 'readyItem') closeMenu();
    }
  };

  const selectItem = (item: OrderItem, keyboard: boolean) => {
    const previous = tap.current;
    if (previous) clearTimeout(previous.timer);
    tap.current = null;
    mutation.clearError();
    if (!editable || !['ready','preparing'].includes(item.status) || keyboard) {
      setSelectedItem(item.id);
      return;
    }
    if (previous?.id === item.id) {
      void itemAction(item.status === 'ready' ? 'serveItem' : 'readyItem', item.id);
      return;
    }
    tap.current = { id: item.id, timer: setTimeout(() => {
      tap.current = null;
      setSelectedItem(item.id);
    }, 280) };
  };

  return (
    <main className="order-screen order-screen--full order-editor">
      <OrderHeader heading={orderTitle(order)} caption={'Гостей ' + order.guestIds.length + (!own ? ' · ' + (state.users[order.waiterId]?.name ?? 'Официант') : '')}
        onBack={() => navigate({ page: from ?? 'orders' })} actions={<>
          {editable && !order.precheckAt && hasGuests && <OrderIconButton label="Открыть меню" onClick={() => catalog(order.guestIds[0])}><BookOpen size={20} /></OrderIconButton>}
          <OrderIconButton label="Действия заказа" onClick={() => setMenu('options')}><Ellipsis size={22} /></OrderIconButton>
        </>} />
      <div className={'order-editor-status tone-' + currentStatus.color}><span />{currentStatus.label}{!isClosed(order) && <time>{alert ? alert.minutes + ' мин' : elapsed(order.createdAt, now)}</time>}</div>
      {order.guestIds.map((guestId, index) => {
        const guestItems = items.filter((item) => item.guestId === guestId);
        const guestTotal = guestItems.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0);
        return <section className="order-guest" key={guestId} aria-labelledby={'guest-' + guestId}>
          <header className="order-guest-heading">
            <h2 id={'guest-' + guestId}>Гость {index + 1}</h2>
            {guestItems.length > 0 && <small>· {guestItems.some(item => item.pricePending) ? 'от ' : ''}{formatCurrency(guestTotal)}</small>}
            {editable && !order.precheckAt && <div className="order-guest-actions">
              {guestItems.length === 0 && order.guestIds.length > 1 && <OrderIconButton label={'Удалить гостя ' + (index + 1)} onClick={() => { void mutation.perform({ type: 'removeGuest', orderId: order.id, guestId }); }}><Minus size={16} /></OrderIconButton>}
              <OrderIconButton label={'Добавить позицию гостю ' + (index + 1)} onClick={() => catalog(guestId)}><Plus size={18} /></OrderIconButton>
            </div>}
          </header>
          <div className="order-item-list">
            {guestItems.map((item) => <div key={item.id} className={`order-item-entry ${item.status === 'served' ? 'order-item-served' : ''}`}>
            <button type="button" className="order-item-row" onClick={event => selectItem(item, event.detail === 0)}>
              <span className="order-item-quantity">{item.quantity}</span>
              <span className="order-item-description">
                <strong>{item.name}</strong>
                {(item.sizeName || item.options.length > 0) && <small>{[item.sizeName, ...item.options.map((option) => option.name)].filter(Boolean).join(' · ')}</small>}
                {item.comment && <small className="order-item-comment">{item.comment}</small>}
              </span>
              <span className="order-item-price"><strong className={item.pricePending ? 'order-price-pending' : undefined}>{item.pricePending ? pendingPriceLabel : formatCurrency(item.unitPrice * item.quantity)}</strong><small className={'item-status-' + item.status}>{itemStatus[item.status]}</small></span>
              <ChevronRight size={16} className="order-item-chevron" aria-hidden="true" />
            </button>
            {editable && (item.status === 'ready' || item.status === 'preparing') && <button type="button"
              className="order-item-quick" disabled={mutation.busy}
              aria-label={(item.status === 'ready' ? 'Выдать: ' : 'Готово: ') + item.name}
              onClick={() => { void itemAction(item.status === 'ready' ? 'serveItem' : 'readyItem', item.id); }}>
              {item.status === 'ready' ? 'Выдать' : 'Готово'}
            </button>}
            </div>)}
            {!guestItems.length && (editable && !order.precheckAt
              ? <button type="button" className="order-item-empty" onClick={() => catalog(guestId)}><Plus size={17} />Добавить из меню</button>
              : <div className="order-item-empty">Позиций нет</div>)}
          </div>
        </section>;
      })}
      {editable && !order.precheckAt && <div className="order-add-guest">
        <button type="button" className="secondary" disabled={mutation.busy} aria-label="Добавить гостя"
          onClick={() => { void mutation.perform({ type: 'addGuest', orderId: order.id, guestId: newId() }); }}>
          <Plus size={17} />Гость
        </button>
      </div>}
      <div className="order-bottom order-editor-bottom">
        {!selected && !menu && <FormError text={mutation.error} />}
        <div className="order-total"><span>{pending.length ? 'Сумма известных цен' : 'Итого'}</span><strong>{formatCurrency(orderTotal(order))}</strong></div>
        {editable && pending.length > 0 && <button type="button" className="secondary order-price-pending" disabled={mutation.busy} onClick={() => {
          mutation.clearError();
          setSelectedItem(pending[0].id);
        }}>Указать цену{pending.length > 1 ? ` · ${pending.length}` : ''}</button>}
        {editable && order.precheckAt !== undefined && <button type="button" className="secondary" disabled={mutation.busy} onClick={() => { void mutation.perform({type:'reopenOrder',orderId:order.id}); }}>Отмена предчека</button>}
        {action && <button type="button" className="primary" disabled={mutation.busy} onClick={action.execute}>{action.icon}{action.label}</button>}
        {editable && !canCheckout && canPrecheck && <button type="button" className="primary" disabled={mutation.busy} onClick={() => { void mutation.perform({type:'precheckOrder',orderId:order.id}); }}>Предчек</button>}
      </div>
      {selected && <OrderSheet title={selected.name} locked={mutation.busy} onClose={closeMenu}>
        {editable && (selected.status === 'preparing' || selected.status === 'ready') && <div className="order-sheet-content">
          {selected.status === 'preparing' ?
            <button type="button" className="primary" disabled={mutation.busy}
              onClick={() => { void itemAction('readyItem', selected.id); }}>Отметить готовым</button> :
            <>
              <button type="button" className="primary" disabled={mutation.busy}
                onClick={() => { void itemAction('serveItem', selected.id); }}>Отметить выданным</button>
              <button type="button" className="secondary" disabled={mutation.busy}
                onClick={() => { void itemAction('unreadyItem', selected.id); }}>Вернуть в приготовление</button>
            </>}
        </div>}
        {editable && !order.precheckAt && !selected.custom && ['draft','preparing','ready'].includes(selected.status) && state.products[selected.productId] ? <ProductForm
          product={state.products[selected.productId]} state={state} order={order} guestId={selected.guestId} item={selected}
          busy={mutation.busy} error={mutation.error}
          submit={async (details) => {
            if (await mutation.perform({ type: 'editItem', orderId: order.id, itemId: selected.id, ...details })) closeMenu();
          }}
          remove={() => { void itemAction('cancelItem', selected.id); }} />
          : <div className="order-sheet-content">
            <div className="order-item-summary">
              <div><small>Статус</small><strong className={'item-status-' + selected.status}>{itemStatus[selected.status]}</strong></div>
              <div><small>Количество</small><strong>{selected.quantity} шт.</strong></div>
              <div><small>Сумма</small><strong>{selected.pricePending ? pendingPriceLabel : formatCurrency(selected.quantity * selected.unitPrice)}</strong></div>
            </div>
            {(selected.sizeName || selected.options.length > 0) && <p className="order-sheet-caption">{[selected.sizeName, ...selected.options.map((option) => option.name)].filter(Boolean).join(' · ')}</p>}
            {selected.comment && <div className="order-detail-comment">{selected.comment}</div>}
            {editable && (selected.status === 'preparing' || selected.status === 'ready') && !order.precheckAt && order.guestIds.length > 1 && <label className="order-field">
              Гость
              <select aria-label="Гость" value={selected.guestId} disabled={mutation.busy} onChange={(event) => { void mutation.perform({ type: 'editItem', orderId: order.id, itemId: selected.id, guestId: event.target.value }); }}>
                {order.guestIds.map((id, index) => <option key={id} value={id}>Гость {index + 1}</option>)}
              </select>
            </label>}
            {editable && !order.precheckAt && selected.custom && selected.status !== 'canceled'
              ? <CustomItemForm key={selected.id} item={selected} busy={mutation.busy} error={mutation.error} submit={async ({ price }) => {
                if (price !== undefined && await mutation.perform({ type: 'setCustomItemPrice', orderId: order.id, itemId: selected.id, price })) closeMenu();
              }} />
              : <FormError text={mutation.error} />}
            {editable && (selected.status === 'draft' || selected.status === 'preparing' || selected.status === 'ready') && <button type="button" className="secondary order-danger" disabled={mutation.busy} onClick={() => { void itemAction('cancelItem', selected.id); }}><Ban size={17} />{selected.status === 'draft' ? 'Удалить позицию' : 'Отменить позицию'}</button>}
            {editable && selected.status === 'served' && verifyServedRemoval && <>
              <p className="order-sheet-caption">В тестировании. Удаление уберёт позицию из суммы заказа. Выданная порция останется списанной.</p>
              <button type="button" className="secondary order-danger" disabled={mutation.busy} onClick={async () => {
                if (await mutation.perform({ type: 'voidServedItem', orderId: order.id, itemId: selected.id }, verifyServedRemoval)) closeMenu();
              }}><Ban size={17} />Удалить выданную позицию</button>
            </>}
          </div>}
      </OrderSheet>}
      {menu && <OrderSheet title={{ checkout: 'Позиции для кассы', cancel: cancelLabel + '?', move: 'Пересадить за другой стол', options: 'Действия заказа' }[menu]} onClose={closeMenu} locked={mutation.busy}>
        {menu === 'checkout' ? <div className="order-sheet-content">
          {!items.length && <p className="order-sheet-caption">Все позиции удалены. Сумма к расчёту 0 ₽.</p>}
          <div className="order-sheet-list">
            {items.map(item => <div className="order-checkout-line" key={item.id}>
              <span>{item.quantity} × {item.name}
                {(item.sizeName || item.options.length > 0) && <small>{[item.sizeName, ...item.options.map(option => option.name)].filter(Boolean).join(' · ')}</small>}
              </span>
              <strong>{formatCurrency(item.quantity * item.unitPrice)}</strong>
            </div>)}
          </div>
          <div className="order-total"><span>Итого</span><strong>{formatCurrency(orderTotal(order))}</strong></div>
          <FormError text={mutation.error} />
          <CloseOrderSwipe disabled={mutation.busy || !editable || !canCheckout} onComplete={async () => {
            if (await mutation.perform({ type: 'closeOrder', orderId: order.id })) closeMenu();
          }} />
        </div> : menu === 'move' ? <div className="order-sheet-content">
          <FormError text={mutation.error} />
          {editable && order.tableId ? <FreeTables state={state} order={order} busy={mutation.busy} onChoose={async tableId => {
            const fromTableId = order.tableId;
            if (fromTableId && await mutation.perform({ type: 'moveOrder', orderId: order.id, fromTableId, tableId })) closeMenu();
          }} /> : <OrderEmpty>Пересадка для этого заказа больше недоступна</OrderEmpty>}
        </div> : menu === 'cancel' ? <div className="order-sheet-content">
          <p className="order-sheet-caption">{unsent ? 'Черновик будет удалён из активных заказов.' : 'Невыданные позиции будут отменены, зарезервированный остаток освободится.'}</p>
          <FormError text={mutation.error} />
          <button type="button" className="secondary order-danger" disabled={mutation.busy} onClick={async () => {
            if (await mutation.perform({ type: 'cancelOrder', orderId: order.id })) navigate({ page: from ?? 'orders' });
          }}>{cancelLabel}</button>
          <button type="button" className="secondary" onClick={closeMenu}>Продолжить обслуживание</button>
        </div> : <div className="order-sheet-list">
          <div className="order-menu-info"><Clock3 size={18} />Создан в {compactTime.format(order.createdAt)}</div>
          <div className="order-menu-info"><UserRound size={18} />{state.users[order.waiterId]?.name ?? 'Официант'}</div>
          {editable && order.tableId && <button type="button" className="order-sheet-row" onClick={() => { mutation.clearError(); setMenu('move'); }}><Sofa size={19} />Пересадить за другой стол</button>}
          {editable && !order.precheckAt && hasGuests && <button type="button" className="order-sheet-row" onClick={() => catalog(order.guestIds[0])}><Plus size={19} />Добавить позиции</button>}
          {editable && canPrecheck && !order.precheckAt && <button type="button" className="order-sheet-row" disabled={mutation.busy} onClick={async () => {
            if (await mutation.perform({ type: 'precheckOrder', orderId: order.id })) closeMenu();
          }}><ClipboardList size={19} />Предчек</button>}
          {editable && ready.length > 0 && <button type="button" className="order-sheet-row" onClick={() => { setMenu(null); setSelectedItem(ready[0].id); }}><Check size={19} />Готовые блюда · {ready.length}</button>}
          {editable && order.precheckAt && <button type="button" className="order-sheet-row" disabled={mutation.busy} onClick={async () => {
            if (await mutation.perform({ type: 'reopenOrder', orderId: order.id })) closeMenu();
          }}><ArrowUpRight size={19} />Отмена предчека</button>}
          {editable && !items.some((item) => item.status === 'served') && <button type="button" className="order-sheet-row order-danger" onClick={() => setMenu('cancel')}><Ban size={19} />{cancelLabel}</button>}
          <FormError text={mutation.error} />
        </div>}
      </OrderSheet>}
    </main>
  );
}

function CloseOrderSwipe({ disabled, onComplete }: {disabled: boolean; onComplete: () => void}) {
  const track = useRef<HTMLDivElement>(null);
  const start = useRef<number | null>(null);
  const [offset, setOffset] = useState(0);
  return <div className="order-swipe" ref={track}>
    <span aria-hidden="true">Свайпните, чтобы закрыть</span>
    <button type="button" aria-label="Закрыть заказ" disabled={disabled} style={{transform: `translateX(${offset}px)`}}
      onClick={event => { if (event.detail === 0) onComplete(); }}
      onPointerDown={event => {
        if (!event.isPrimary || event.button !== 0) return;
        start.current = event.clientX;
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => {
        if (start.current === null) return;
        const distance = (track.current?.clientWidth ?? 0) - event.currentTarget.offsetWidth - 8;
        setOffset(Math.max(0, Math.min(distance, event.clientX - start.current)));
      }}
      onPointerUp={event => {
        if (start.current === null) return;
        const distance = (track.current?.clientWidth ?? 0) - event.currentTarget.offsetWidth - 8;
        const complete = distance > 0 && event.clientX - start.current >= distance - 7;
        start.current = null;
        setOffset(0);
        if (complete) onComplete();
      }}
      onLostPointerCapture={() => { start.current = null; setOffset(0); }}>
      <ChevronRight size={23} />
    </button>
  </div>;
}

function ProductImage({ product, compact = false }: { product: Product; compact?: boolean }) {
  const [brokenUrl, setBrokenUrl] = useState<string>();
  const [loadedUrl, setLoadedUrl] = useState<string>();
  const url = product.imageUrl;
  const validUrl = url && (/^https?:\/\//i.test(url) || /^\/[^/\\]/.test(url)) && url !== brokenUrl;
  return <div className={'order-product-image' + (compact ? ' order-product-image--compact' : '')}>
    {(!validUrl || loadedUrl !== url) && <><ImageOff size={compact ? 23 : 29} /><span>Нет изображения</span></>}
    {validUrl && <img src={url} alt="" loading="lazy" decoding="async" className={loadedUrl === url ? 'is-loaded' : undefined}
      onLoad={() => setLoadedUrl(url)} onError={() => setBrokenUrl(url)} />}
  </div>;
}

function Catalog({ state, user, execute, navigate, order, screen }: OrdersProps & {
  order: Order;
  screen: Extract<OrdersScreen, { page: 'catalog' }>;
}) {
  const [search, setSearch] = useState('');
  const searchField = useRef<HTMLInputElement>(null);
  const [productId, setProductId] = useState<string | null>(null);
  const [customName, setCustomName] = useState<string | null>(null);
  const [added, setAdded] = useState('');
  const mutation = useMutations(execute);
  const editable = (user.role === 'admin' || order.waiterId === user.userId) && !isClosed(order) && !order.precheckAt && order.guestIds.includes(screen.guestId);
  const category = screen.categoryId ? state.categories[screen.categoryId] : undefined;
  const query = search.trim().toLocaleLowerCase('ru');
  const categories = entries(state.categories).filter((entry) => !entry.archived).sort(sortByRank);
  const products = entries(state.products)
    .filter((entry) => !entry.archived && !state.categories[entry.categoryId]?.archived)
    .filter((entry) => query
      ? [entry.name, entry.description, state.categories[entry.categoryId]?.name].filter(Boolean).some((text) => text?.toLocaleLowerCase('ru').includes(query))
      : entry.categoryId === category?.id)
    .sort(sortByRank);
  const product = productId ? state.products[productId] : undefined;
  const showProducts = Boolean(category || query);
  const hasPendingPrice = orderItems(order).some(item => item.pricePending);
  const orderScreen: OrdersScreen = { page: 'order', orderId: order.id, from: screen.from };

  const openCustom = (name: string) => {
    searchField.current?.blur();
    mutation.clearError();
    setCustomName(name.slice(0, 80));
  };

  const chooseProduct = async (entry: Product) => {
    searchField.current?.blur();
    mutation.clearError();
    if (entry.sizes?.length || entry.modifierIds?.length) {
      setProductId(entry.id);
      return;
    }
    const command: Command = {
      type: 'addItem', orderId: order.id, guestId: screen.guestId, itemId: newId(), productId: entry.id, quantity: 1,
    };
    if (await mutation.perform(command)) setAdded(entry.name + ' · добавлено');
  };

  return (
    <main className="order-screen order-screen--full order-catalog">
      <header className="order-catalog-header">
        <h1 className="order-visually-hidden">Меню</h1>
        <label className="order-search">
          <Search size={19} aria-hidden="true" />
          <input ref={searchField} type="search" enterKeyHint="search" placeholder="Поиск позиций" aria-label="Поиск позиций" value={search} onChange={(event) => { setSearch(event.target.value); setAdded(''); }}
            onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) event.currentTarget.blur(); }} />
          {search && <button type="button" aria-label="Очистить поиск" onClick={() => setSearch('')}><X size={17} /></button>}
        </label>
        <OrderIconButton label="Закрыть меню" onClick={() => navigate(orderScreen)}><X size={21} /></OrderIconButton>
      </header>
      {added && <div className="order-catalog-message" role="status"><Check size={18} />{added}</div>}
      {!editable && <OrderEmpty>Добавление позиций в этот заказ недоступно</OrderEmpty>}
      {editable && showProducts && <>
        <div className="order-catalog-location">
          {category && <OrderIconButton label="Все категории" onClick={() => { setSearch(''); navigate({ ...screen, categoryId: undefined }); }}><ArrowLeft size={19} /></OrderIconButton>}
          <h2>{query ? 'Результаты поиска' : category?.name}</h2>
        </div>
        {products.length ? <div className="order-product-grid">
          {products.map((entry) => {
            const out = stockStatus(state, entry.id) === 'out';
            return <button type="button" className="order-product" key={entry.id} disabled={out || mutation.busy}
              onClick={() => { void chooseProduct(entry); }}>
              <ProductImage product={entry} compact />
              <span className="order-product-info"><strong>{entry.name}</strong><small>{out ? 'В стоп-листе' : formatCurrency(entry.price)}</small></span>
            </button>;
          })}
        </div> : query ? <div className="order-custom-offer">
          <OrderEmpty icon={<Search size={26} />}>Похоже, такой позиции в меню нет. Добавить свою?</OrderEmpty>
          <button type="button" className="secondary" disabled={mutation.busy} onClick={() => openCustom(search.trim())}><Plus size={18} />Добавить свою позицию</button>
        </div> : <OrderEmpty icon={<Search size={26} />}>В категории пока нет позиций</OrderEmpty>}
      </>}
      {editable && !showProducts && <div className="order-category-grid">
        <button type="button" className="order-category order-custom-tile" disabled={mutation.busy} onClick={() => openCustom('')}>
          <Plus size={21} />Своя позиция
        </button>
        {categories.map((entry) => {
          const accent = /^#[0-9a-f]{6}$/i.test(entry.color) ? entry.color : '#49556d';
          return <button type="button" className="order-category" key={entry.id} style={{ borderInlineStartColor: accent, backgroundColor: 'color-mix(in srgb, ' + accent + ' 20%, var(--order-surface))' }}
            onClick={() => { setAdded(''); navigate({ ...screen, categoryId: entry.id }); }}>{entry.name}</button>;
        })}
      </div>}
      {!product && customName === null && <FormError text={mutation.error} />}
      <div className="order-bottom order-catalog-bottom">
        <button type="button" className="secondary" onClick={() => navigate(orderScreen)}><ClipboardList size={19} />К заказу <strong>{hasPendingPrice ? 'от ' : ''}{formatCurrency(orderTotal(order))}</strong></button>
      </div>
      {customName !== null && <OrderSheet title="Своя позиция" onClose={() => { setCustomName(null); mutation.clearError(); }} locked={mutation.busy}>
        <CustomItemForm initialName={customName} busy={mutation.busy} error={mutation.error} submit={async details => {
          if (await mutation.perform({ type: 'addCustomItem', orderId: order.id, guestId: screen.guestId, itemId: newId(), ...details })) {
            setCustomName(null);
            setSearch('');
            setAdded(details.name + ' · добавлено');
          }
        }} />
      </OrderSheet>}
      {product && <OrderSheet title={product.name} onClose={() => { setProductId(null); mutation.clearError(); }} locked={mutation.busy}>
        <ProductForm product={product} state={state} order={order} guestId={screen.guestId} busy={mutation.busy} error={mutation.error}
          submit={async ({ guestId, ...details }) => {
            if (await mutation.perform({ type: 'addItem', orderId: order.id, guestId, itemId: newId(), productId: product.id, ...details })) {
              setProductId(null);
              setAdded(product.name + ' · добавлено');
            }
          }} />
      </OrderSheet>}
    </main>
  );
}

function CustomItemForm({ initialName = '', item, busy, error, submit }: {
  initialName?: string;
  item?: OrderItem;
  busy: boolean;
  error: string;
  submit: (details: { name: string; comment: string; price?: number }) => Promise<void>;
}) {
  const [name, setName] = useState(item?.name ?? initialName);
  const [comment, setComment] = useState('');
  const [priceText, setPriceText] = useState(item && !item.pricePending ? String(item.unitPrice).replace('.', ',') : '');
  const amount = priceText.trim();
  const price = /^\d+(?:[.,]\d{1,2})?$/.test(amount) ? Number(amount.replace(',', '.')) : NaN;
  const validPrice = Number.isFinite(price) && price <= 1_000_000;
  const canSubmit = !busy && Boolean(name.trim());

  return <form className="order-sheet-content" onSubmit={event => {
    event.preventDefault();
    if (canSubmit && validPrice) void submit({ name: name.trim(), comment: comment.trim(), price });
  }}>
    {!item && <>
      <label className="order-field">Название<input value={name} maxLength={80} onChange={event => setName(event.target.value)} /></label>
      <label className="order-field">Комментарий<textarea rows={2} value={comment} maxLength={500} onChange={event => setComment(event.target.value)} /></label>
    </>}
    <label className="order-field">Цена, ₽<input inputMode="decimal" enterKeyHint="done" value={priceText} maxLength={12} onChange={event => setPriceText(event.target.value)} /></label>
    <FormError text={error} />
    <button type="submit" className="primary" disabled={!canSubmit || !validPrice}>{item ? 'Сохранить цену' : 'Добавить в заказ'}</button>
    {!item && <button type="button" className="secondary" disabled={!canSubmit} onClick={() => {
      void submit({ name: name.trim(), comment: comment.trim() });
    }}>Уточню позже</button>}
  </form>;
}

function ProductForm({ product, state, order, guestId, item, busy, error, submit, remove }: {
  product: Product;
  state: State;
  order: Order;
  guestId: string;
  item?: OrderItem;
  busy: boolean;
  error: string;
  submit: (details: ItemDetails) => Promise<void>;
  remove?: () => void;
}) {
  const sizes = product.sizes ?? [];
  const groups = (product.modifierIds ?? []).map((id) => state.modifiers[id]).filter(Boolean);
  const [sizeId, setSizeId] = useState(item?.sizeId ?? sizes[0]?.id);
  const [options, setOptions] = useState(item?.optionIds ?? []);
  const [quantity, setQuantity] = useState(item?.quantity ?? 1);
  const [comment, setComment] = useState(item?.comment ?? '');
  const [customSyrup,setCustomSyrup] = useState(item?.options.find(option => option.name.startsWith('Свой сироп: '))?.name.slice(12) ?? '');
  const [showCustomSyrup,setShowCustomSyrup] = useState(Boolean(customSyrup));
  const [destination, setDestination] = useState(guestId);
  const [expanded, setExpanded] = useState<string | null>(null);
  const controlsId = useId();
  const size = sizes.find((entry) => entry.id === sizeId);
  const allOptions = groups.flatMap((group) => group.options);
  const chosenOptions = allOptions.filter((option) => options.includes(option.id));
  const selectedPrice = size?.price ?? product.price;
  const extraPrice = chosenOptions.reduce((sum, option) => sum + option.price, 0) + (showCustomSyrup && customSyrup.trim() ? 60 : 0);
  const stock = availableQuantity(state, product.id);
  const available = stock === null ? null : stock + (item && item.status !== 'draft' ? item.quantity : 0);
  const canOrder = Boolean(item) || stockStatus(state, product.id) !== 'out';
  const canSave = (!showCustomSyrup || Boolean(customSyrup.trim())) && canOrder && groups.every((group) => !group.required || group.options.some((option) => options.includes(option.id)))
    && (available === null || quantity <= available) && (!sizes.length || Boolean(size));
  const toggleOptions = (key: string) => setExpanded((current) => current === key ? null : key);
  const chooseOption = (group: typeof groups[number], optionId: string) => {
    if (options.includes(optionId)) {
      setOptions(options.filter((id) => id !== optionId));
    } else {
      const groupIds = group.options.map((option) => option.id);
      setOptions([...(group.multiple ? options : options.filter((id) => !groupIds.includes(id))), optionId]);
    }
    if (!group.multiple) setExpanded(null);
  };

  return (
    <form className="order-sheet-content order-product-form" onSubmit={(event) => {
      event.preventDefault();
      if (canSave && !busy) void submit({
        quantity, ...(sizeId ? { sizeId } : {}), optionIds: chosenOptions.map((option) => option.id), customSyrup: showCustomSyrup ? customSyrup.trim() : '', comment: comment.trim(), guestId: destination,
      });
    }}>
      <div className="order-product-preview">
        <ProductImage product={product} />
        <div className="order-product-copy">
          <strong>{formatCurrency(selectedPrice + extraPrice)}</strong>
          {product.volume && <span>{product.volume}</span>}
          {available !== null && <span>Доступно · {available} шт.</span>}
          <Stepper value={quantity} onChange={setQuantity} label="Количество" max={Math.max(1, Math.min(999, available ?? 999))} />
        </div>
      </div>
      {product.description && <p className="order-sheet-caption">{product.description}</p>}
      {sizes.length > 0 && <div className="order-config">
        <button type="button" className="order-config-row" aria-expanded={expanded === 'size'} aria-controls={controlsId + '-size'}
          onClick={() => toggleOptions('size')}>
          <span>Размер или объём</span><small>{size?.name ?? 'Выбрать'}</small><ChevronRight size={15} />
        </button>
        <div id={controlsId + '-size'} className="order-product-options" role="group" aria-label="Доступные размеры" hidden={expanded !== 'size'}>
          {sizes.map((entry) => <button type="button" className="order-choice" key={entry.id} aria-pressed={entry.id === sizeId}
            onClick={() => { setSizeId(entry.id); setExpanded(null); }}>
            <span>{entry.name}</span><small>{formatCurrency(entry.price)}</small>{entry.id === sizeId && <Check size={16} />}
          </button>)}
        </div>
      </div>}
      {groups.length > 0 && <div className="order-modifiers">
        <h3>Модификаторы</h3>
        <div className="order-config">
          {groups.map((group) => {
            const only = group.options.length === 1 ? group.options[0] : null;
            const summary = group.options.filter((entry) => options.includes(entry.id)).map((entry) =>
              entry.name + (entry.price ? ' +' + formatCurrency(entry.price) : '')).join(', ');
            if (only && !group.required) return <button
              type="button" className="order-config-row" key={group.id} role="switch" aria-label={group.name}
              aria-checked={options.includes(only.id)} onClick={() => chooseOption(group, only.id)}
            ><span>{group.name}</span>{only.price > 0 && <small>+{formatCurrency(only.price)}</small>}<span className="order-config-switch" aria-hidden="true" /></button>;
            return <div className="order-config-group" key={group.id}>
              <button type="button" className="order-config-row" aria-expanded={expanded === group.id} aria-controls={controlsId + '-' + group.id}
                onClick={() => toggleOptions(group.id)}>
                <span>{group.name}</span><small>{summary || (group.required ? 'Выбрать' : 'Без добавки')}</small><ChevronRight size={15} />
              </button>
              <div id={controlsId + '-' + group.id} className="order-product-options" role="group" aria-label={group.name} hidden={expanded !== group.id}>
                {group.options.map((entry) => <button type="button" className="order-choice" key={entry.id} aria-pressed={options.includes(entry.id)}
                  onClick={() => chooseOption(group, entry.id)}>
                  <span>{entry.name}</span>{entry.price !== 0 && <small>{entry.price > 0 ? '+' : ''}{formatCurrency(entry.price)}</small>}
                  {options.includes(entry.id) && <Check size={16} />}
                </button>)}
              </div>
            </div>;
          })}
        </div>
      </div>}
      {groups.some(group => /сироп/i.test(group.name)) && <div className="order-config"><button type="button" className="order-config-row" onClick={() => setShowCustomSyrup(v => !v)} aria-expanded={showCustomSyrup}><span>{showCustomSyrup ? 'Убрать свой сироп' : '+ Свой сироп'}</span><small>60 ₽</small></button>{showCustomSyrup && <label className="order-field">Название сиропа<input value={customSyrup} maxLength={80} onChange={e=>setCustomSyrup(e.target.value)} placeholder="Введите вкус" /></label>}</div>}
      {item && order.guestIds.length > 1 && <label className="order-field">
        Гость
        <select aria-label="Гость" value={destination} onChange={(event) => setDestination(event.target.value)}>
          {order.guestIds.map((id, index) => <option key={id} value={id}>Гость {index + 1}</option>)}
        </select>
      </label>}
      <label className="order-field order-comment"><span className="order-visually-hidden">Комментарий к блюду</span>
        <textarea placeholder="Комментарий к блюду…" value={comment} maxLength={500} rows={2} onChange={(event) => setComment(event.target.value)} />
      </label>
      {!canOrder && <p className="order-sheet-caption order-danger">Позиция в стоп-листе</p>}
      <FormError text={error} />
      <div className="order-product-actions">
        <button type="submit" className="primary" disabled={busy || !canSave}>{item ? 'Сохранить' : 'Добавить'} — {formatCurrency((selectedPrice + extraPrice) * quantity)}</button>
        {remove && <button type="button" className="secondary order-danger" disabled={busy} onClick={remove}>{item?.status === 'draft' ? 'Удалить позицию' : 'Отменить позицию'}</button>}
      </div>
    </form>
  );
}
