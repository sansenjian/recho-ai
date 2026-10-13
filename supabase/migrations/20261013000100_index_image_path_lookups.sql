-- 缩略图/预览图路径的访问校验索引。
--
-- 背景：ProxyStorage 与 PresignStorage 都要按 storage_path / preview_path /
-- thumbnail_path 三列之一反查 image_generations，判断图片是公有还是私有。
-- 查询写成三列 OR：
--
--   WHERE storage_path = $1 OR preview_path = $1 OR thumbnail_path = $1
--
-- 这种写法用不上单列索引——优化器无法把 OR 拆成几次索引扫描，只能全表顺序
-- 扫描。而 storage_path 的索引（image_generations_storage_path_idx，见
-- 20260626000000_restore_admin_rpcs.sql）是给管理端 storage overview RPC 用的
-- 单列索引，对这条 OR 查询同样无效，preview_path / thumbnail_path 则连索引
-- 都没有。
--
-- 代价不只一次扫描：候选链会把同一张图展开成十几个候选路径（见 Go 侧
-- proxyStorageCandidatePaths），逐个候选各查一次库。补上这两列后，OR 的每一
-- 支都有索引可用，优化器可以改成 BitmapOr 走三次索引扫描，不必再读全表。

create index if not exists image_generations_preview_path_idx
  on public.image_generations (preview_path);

create index if not exists image_generations_thumbnail_path_idx
  on public.image_generations (thumbnail_path);

comment on index public.image_generations_preview_path_idx is
  'Supports the storage_path/preview_path/thumbnail_path OR lookup used by image access checks.';

comment on index public.image_generations_thumbnail_path_idx is
  'Supports the storage_path/preview_path/thumbnail_path OR lookup used by image access checks.';
