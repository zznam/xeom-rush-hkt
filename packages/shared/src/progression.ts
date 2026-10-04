import type { CareerProfile } from './career';
export interface Objective {
  id: string;
  title: string;
  metric: string;
  goal: number;
}
export const DAILY_OBJECTIVES: Objective[] = [
  { id: 'first-fares', title: 'Ba chuyến mở hàng', metric: 'deliveries', goal: 3 },
  { id: 'safe-day', title: 'Hai chuyến bình an', metric: 'clean', goal: 2 },
  { id: 'food-run', title: 'Bữa trưa nóng hổi', metric: 'food', goal: 2 },
  { id: 'parcel-run', title: 'Bưu kiện xuyên phố', metric: 'parcel', goal: 2 },
  { id: 'city-tour', title: 'Đi một vòng Sài Gòn', metric: 'distance', goal: 2000 },
  { id: 'market-run', title: 'Đón khách khu chợ', metric: 'market', goal: 2 },
  { id: 'downtown-run', title: 'Chuyến xe trung tâm', metric: 'downtown', goal: 2 },
  { id: 'old-town-run', title: 'Ghé phố xưa', metric: 'old-town', goal: 2 },
  { id: 'river-run', title: 'Dạo bờ sông', metric: 'riverside', goal: 2 },
  { id: 'rain-run', title: 'Tài xế ngày mưa', metric: 'rain', goal: 1 },
  { id: 'night-run', title: 'Đèn phố lên rồi', metric: 'night', goal: 1 },
  { id: 'happy-guests', title: 'Khách vui có tiền boa', metric: 'tipped', goal: 3 },
];
export const WEEKLY_CONTRACTS: Objective[] = [
  { id: 'week-shift', title: 'Một tuần chăm chỉ', metric: 'deliveries', goal: 25 },
  { id: 'week-safe', title: 'Đường phố bình an', metric: 'clean', goal: 15 },
  { id: 'week-food', title: 'Bếp gửi niềm vui', metric: 'food', goal: 8 },
  { id: 'week-parcel', title: 'Bưu tá Sài Gòn', metric: 'parcel', goal: 8 },
  { id: 'week-tour', title: 'Hai mươi cây số', metric: 'distance', goal: 20000 },
  { id: 'week-market', title: 'Người quen khu chợ', metric: 'market', goal: 10 },
  { id: 'week-night', title: 'Đồng hành phố đêm', metric: 'night', goal: 8 },
  { id: 'week-rain', title: 'Qua những cơn mưa', metric: 'rain', goal: 5 },
];
// UTC+7 has no daylight-saving transitions. Monday 00:00 local is the weekly boundary.
export function progressionPeriods(now = Date.now()) {
  const local = new Date(now + 7 * 3600000);
  const daily = local.toISOString().slice(0, 10);
  local.setUTCDate(local.getUTCDate() - ((local.getUTCDay() + 6) % 7));
  return { daily: `d:${daily}`, weekly: `w:${local.toISOString().slice(0, 10)}` };
}
export function activeObjectives(now = Date.now()) {
  const periods = progressionPeriods(now);
  const day = Math.floor((now + 7 * 3600000) / 86400000);
  const rotation = (items: Objective[], count: number, seed: number, period: string) =>
    Array.from({ length: count }, (_, i) => ({
      ...items[(((seed * count + i) % items.length) + items.length) % items.length],
      period,
    }));
  return [
    ...rotation(DAILY_OBJECTIVES, 3, day, periods.daily),
    ...rotation(WEEKLY_CONTRACTS, 2, Math.floor((day + 3) / 7), periods.weekly),
  ];
}
export const COSMETICS = [
  ...[
    'Lá xanh',
    'San hô',
    'Nắng vàng',
    'Chàm đêm',
    'Hồng sen',
    'Biển ngọc',
    'Mận chín',
    'Kem dừa',
    'Cam đất',
    'Xanh trời',
    'Tím chiều',
    'Bạc phố',
  ].map((name, i) => ({
    id: `paint-${i}`,
    slot: 'paint',
    name,
    color: [
      '#2eaa90',
      '#ef927b',
      '#f4c04f',
      '#4263a8',
      '#de6b98',
      '#23b8b5',
      '#aa4971',
      '#eee0bb',
      '#dc8544',
      '#65acd4',
      '#9479ba',
      '#a0adae',
    ][i],
    claims: i,
  })),
  ...['Trắng sữa', 'Vàng chanh', 'Đỏ gạch', 'Xanh ngọc', 'Tím hoa', 'Đen than'].map((name, i) => ({
    id: `helmet-${i}`,
    slot: 'helmet',
    name,
    color: ['#fff2cf', '#ffe073', '#d9654d', '#42c5b5', '#9c83ca', '#35454e'][i],
    claims: i * 2,
  })),
  ...['Áo xanh', 'Áo vàng', 'Áo đỏ', 'Áo chàm', 'Áo hồng', 'Áo kem'].map((name, i) => ({
    id: `jacket-${i}`,
    slot: 'jacket',
    name,
    color: ['#27735f', '#dda536', '#bd5552', '#415c89', '#bd7293', '#ead8b1'][i],
    claims: i * 2,
  })),
  ...['Bíp cổ điển', 'Chuông phố', 'Hai nốt vui', 'Còi trầm'].map((name, i) => ({
    id: `horn-${i}`,
    slot: 'horn',
    name,
    color: '',
    claims: i * 3,
  })),
];
export const MASTERY_BADGES = [
  ...[1, 10, 50, 100].map((goal, i) => ({
    id: `driver-${i}`,
    title: ['Mở hàng', 'Quen đường', 'Tay lái phố', 'Lão làng'][i],
    metric: 'deliveries',
    goal,
  })),
  ...[5, 25, 75].map((goal, i) => ({
    id: `safe-${i}`,
    title: ['Êm tay ga', 'Bạn đường an tâm', 'Lái xe mẫu mực'][i],
    metric: 'clean',
    goal,
  })),
  ...[3, 6, 12].map((goal, i) => ({
    id: `explorer-${i}`,
    title: ['Góc phố thân quen', 'Người kể chuyện', 'Hộ chiếu trọn vẹn'][i],
    metric: 'landmarks',
    goal,
  })),
  { id: 'combo-master', title: 'Nhịp phố không ngừng', metric: 'streak', goal: 10 },
  { id: 'long-road', title: 'Trăm cây số', metric: 'distance', goal: 100000 },
];
export function mastery(profile: CareerProfile) {
  const values: Record<string, number> = {
    deliveries: profile.totalDeliveries,
    clean: profile.summary.cleanTrips,
    landmarks: profile.summary.visited.length,
    streak: profile.peakStreak,
    distance: profile.summary.distance,
  };
  return MASTERY_BADGES.map((b) => ({ ...b, value: values[b.metric] ?? 0, earned: (values[b.metric] ?? 0) >= b.goal }));
}
export function unlockCosmetics(profile: CareerProfile) {
  profile.claimCount ??= profile.claims.length;
  profile.unlocked = [
    ...new Set([...profile.unlocked, ...COSMETICS.filter((c) => c.claims <= profile.claimCount!).map((c) => c.id)]),
  ];
  return profile;
}
