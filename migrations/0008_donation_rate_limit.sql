-- 投喂限流的索引：按「同一 IP 对同一个饭碗儿」数笔数
--
-- donations.ip_hash 存的是 sha256(ip | 北京时间日期 | SERVER_SECRET) 的前 32 位，
-- 也就是说它本身每天就会换一批 —— 「今天投了几笔」直接按 ip_hash 数就是对的，
-- 不用再自己算日期边界。这个索引让那两条 COUNT 不必全表扫。
CREATE INDEX IF NOT EXISTS idx_donations_ip_bowl
  ON donations(ip_hash, bowl_id, created_at);
