import { LANDMARKS } from './atlas';
import type { PassengerState, Vector2D } from './types';
export type JobKind = 'passenger' | 'food' | 'parcel';
export interface JobState {
  kind: JobKind;
  persona: string;
  dialogue: string;
  goal: 'safe' | 'quick' | 'scenic';
  goalLabel: string;
  stops: Vector2D[];
  stopIndex: number;
  pickedUpTick: number;
  damage: number;
  scenic: boolean;
  quickTicks: number;
}
export const PERSONAS = [
  {
    id: 'auntie',
    name: 'Dì Ba',
    goal: 'safe',
    goalLabel: 'Đi an toàn để nhận tip',
    lines: [
      'Con cứ chạy từ từ, dì không vội đâu.',
      'Đường này sáng nào cũng thơm mùi bánh mì.',
      'Nhớ nhìn người đi bộ nha con.',
      'Dì mang ít trái cây qua thăm bạn.',
      'Cái hẻm nhỏ kia hồi xưa dì đi suốt.',
      'Đèn đỏ thì mình nghỉ một chút cũng được.',
      'Hôm nay trời đẹp, đi xe thấy vui ghê.',
      'Tới nơi dì mua cho con chai nước nhé.',
      'Sài Gòn đông nhưng ai cũng có đường về.',
      'Dì thích tay lái nhẹ nhàng như vậy.',
      'Qua chợ nhớ chừa đường cho người ta nha.',
      'Một chuyến xe an toàn là dì vui rồi.',
    ],
  },
  {
    id: 'office',
    name: 'Anh Minh',
    goal: 'quick',
    goalLabel: 'Đến trong thời gian gợi ý để nhận tip',
    lines: [
      'Cuộc họp sắp bắt đầu, mình đi đường gọn nhé.',
      'Đi nhanh vừa đủ, vẫn nhớ đèn đỏ nha.',
      'Tôi đã chuẩn bị bài trình bày từ tối qua.',
      'Có lối nào tránh đoạn đông phía trước không?',
      'Cà phê sáng nay giúp tôi tỉnh cả người.',
      'Văn phòng ngay gần điểm hẹn thôi.',
      'Hôm nay tôi có ba cuộc họp liên tiếp.',
      'Tôi gửi địa chỉ rồi, bạn theo bản đồ nhé.',
      'Đường thông thoáng quá, may thật.',
      'Sắp tới giờ nhưng mình cứ lái cẩn thận.',
      'Đến sớm một chút là tôi kịp chuẩn bị.',
      'Cảm ơn bạn đã đưa tôi tới đúng hẹn.',
    ],
  },
  {
    id: 'tourist',
    name: 'Linh du khách',
    goal: 'scenic',
    goalLabel: 'Ghé ngang một địa danh để nhận tip',
    lines: [
      'Bạn chỉ tôi một góc Sài Gòn đẹp nhé.',
      'Tôi muốn nhớ thành phố qua những con phố nhỏ.',
      'Nhà thờ bên kia trông thật ấn tượng.',
      'Đi qua bến sông được không bạn?',
      'Tôi nghe nói chợ ở đây rất nhộn nhịp.',
      'Mỗi con hẻm có một màu sắc riêng.',
      'Tôi đang làm một cuốn sổ du lịch nhỏ.',
      'Thật vui khi ngắm phố từ yên sau xe.',
      'Tôi vừa gửi ảnh về cho gia đình.',
      'Một điểm dừng mới là thêm một kỷ niệm.',
      'Tôi thích những hàng cây ven đường.',
      'Chuyến xe này giúp tôi hiểu thành phố hơn.',
    ],
  },
  {
    id: 'student',
    name: 'Bạn An',
    goal: 'quick',
    goalLabel: 'Đến trong thời gian gợi ý để nhận tip',
    lines: [
      'Mình sắp vào tiết học rồi, nhờ bạn nhé.',
      'Hôm nay mình có bài thuyết trình nhóm.',
      'Mình mang cả tập vở trong chiếc túi này.',
      'Qua cổng trường là tới điểm hẹn.',
      'Bạn có biết quán nước gần trường không?',
      'Mình đã ôn bài trên đường đi rồi.',
      'Tan học mình lại ghé thư viện.',
      'Đường đông hơn hôm qua một chút nhỉ.',
      'Mình thích đi xe máy ngắm phố buổi sáng.',
      'Đến đúng giờ là mình yên tâm.',
      'Cảm ơn bạn, nhóm mình đang đợi.',
      'Thi xong mình sẽ đi khám phá thành phố.',
    ],
  },
  {
    id: 'chef',
    name: 'Chị Mai',
    goal: 'safe',
    goalLabel: 'Đi an toàn để nhận tip',
    lines: [
      'Chị đem món mới cho bạn nếm thử.',
      'Bánh còn ấm, mình lái êm một chút nha.',
      'Quán nhỏ của chị vừa mở cửa sáng nay.',
      'Mùi sả hôm nay thơm cả căn bếp.',
      'Túi đồ này có phần ăn cho người bạn.',
      'Đường tới quán chị có hàng cây lớn.',
      'Chị thích những chuyến xe nhẹ nhàng.',
      'Qua chợ chị còn mua thêm ít rau.',
      'Nấu ăn ngon cũng cần nhiều kiên nhẫn.',
      'Chị đã gói đồ thật cẩn thận rồi.',
      'Tới nơi nhớ ghé quán uống nước nhé.',
      'Cảm ơn con đã giữ chuyến xe thật êm.',
    ],
  },
  {
    id: 'artist',
    name: 'Chú Sơn',
    goal: 'scenic',
    goalLabel: 'Ghé ngang một địa danh để nhận tip',
    lines: [
      'Chú đang tìm một góc phố để vẽ.',
      'Ánh nắng trên mái nhà hôm nay đẹp quá.',
      'Một hàng cây cũng có thể thành bức tranh.',
      'Cho chú ngắm thêm đường phố nhé.',
      'Chú mang màu nước trong chiếc túi nhỏ.',
      'Tiếng phố xá giúp chú nghĩ ra ý tưởng.',
      'Bến nước lúc chiều có màu rất dịu.',
      'Chú thích những biển hiệu cũ quanh chợ.',
      'Mỗi chuyến xe cho chú một nét vẽ mới.',
      'Thành phố đổi màu theo từng giờ.',
      'Đi qua một địa danh là chú có thêm cảm hứng.',
      'Cảm ơn con, hôm nay chú có nhiều ý tưởng rồi.',
    ],
  },
] as const;
export function jobIndex(id: string) {
  const digits = Number(id.replace(/^pass-/, ''));
  return Number.isFinite(digits) ? digits : 0;
}
export function createJob(passenger: PassengerState): JobState {
  const index = jobIndex(passenger.id),
    persona = PERSONAS[index % PERSONAS.length];
  const kind: JobKind = index % 10 < 6 ? 'passenger' : index % 10 < 8 ? 'food' : 'parcel';
  const final = { x: passenger.destX, y: passenger.destY };
  const stops: Vector2D[] =
    kind === 'parcel'
      ? [
          { x: LANDMARKS[index % 12].x, y: LANDMARKS[index % 12].y },
          ...(index % 2 ? [{ x: LANDMARKS[(index + 5) % 12].x, y: LANDMARKS[(index + 5) % 12].y }] : []),
          final,
        ]
      : [final];
  return {
    kind,
    persona: persona.id,
    dialogue: persona.lines[Math.floor(index / 6) % 12],
    goal: persona.goal,
    goalLabel:
      kind === 'food'
        ? 'Giao món còn nóng: tip theo độ tươi'
        : kind === 'parcel'
          ? 'Giữ kiện hàng nguyên vẹn để nhận tip'
          : persona.goalLabel,
    stops,
    stopIndex: 0,
    pickedUpTick: 0,
    damage: 0,
    scenic: false,
    quickTicks: Math.max(1200, Math.ceil((Math.hypot(passenger.x - final.x, passenger.y - final.y) / 200) * 40)),
  };
}
export function freshness(job: JobState, tick: number) {
  return Math.max(0, 1 - Math.max(0, tick - job.pickedUpTick) / 2400);
}
export function jobTip(base: number, job: JobState, tick: number, dirty: boolean) {
  const quality =
    job.kind === 'food'
      ? freshness(job, tick)
      : job.kind === 'parcel'
        ? 1 - job.damage
        : job.goal === 'safe'
          ? dirty
            ? 0
            : 1
          : job.goal === 'quick'
            ? tick - job.pickedUpTick <= job.quickTicks
              ? 1
              : 0
            : job.scenic
              ? 1
              : 0;
  return Math.floor(base * 0.15 * Math.max(0, Math.min(1, quality)));
}
export const JOB_LABELS: Record<JobKind, string> = {
  passenger: 'Chở khách',
  food: 'Giao đồ ăn',
  parcel: 'Giao kiện hàng',
};
