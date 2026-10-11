-- 消息评价（点赞 / 点踩）。
--
-- 只记录最终态度，不做事件流：同一条消息同一个用户重复评价时覆盖上一次，
-- 所以 (user_id, message_key) 是唯一的。message_key 用字符串而不是 uuid —— 对话页的
-- 消息 id 是前端生成的（如 msg-xxx），工作台用的是生成批次 id，都不是 uuid。
--
-- 一条消息可能在不同会话里出现（例如用户转发提示词），因此不建到 messages 的外键：
-- 消息本身存在浏览器 localStorage，服务端没有对应的行。

create table if not exists public.message_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  message_key text not null,
  -- 1 = 好评，-1 = 差评。
  value smallint not null,
  -- 评价对象所属场景，便于分开统计（对话页 / 工作台生图）。
  surface text not null default 'chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint message_feedback_value_check check (value in (1, -1)),
  constraint message_feedback_surface_check check (surface in ('chat', 'image')),
  constraint message_feedback_key_length_check check (char_length(message_key) between 1 and 200)
);

-- 同一条消息同一个用户只有一条评价：重复提交走 upsert 覆盖。
create unique index if not exists message_feedback_user_message_unique
  on public.message_feedback (user_id, message_key);

-- 按场景统计满意度时用得上。
create index if not exists message_feedback_surface_value_idx
  on public.message_feedback (surface, value, created_at desc);

alter table public.message_feedback enable row level security;

-- 只允许通过服务端写入：前端拿不到别人的评价，也不能伪造 user_id。
revoke all on table public.message_feedback from anon, authenticated, public;
grant select, insert, update, delete on table public.message_feedback to service_role;

comment on table public.message_feedback is
  '用户对单条消息的好评/差评；同一用户对同一消息只保留最新一条。';
comment on column public.message_feedback.message_key is
  '前端生成的消息标识（对话页消息 id 或工作台生成批次 id），非 uuid。';
