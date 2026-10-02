-- Linux 学习打卡平台 · 账号初始化
-- 由 gen_seed.py 自动生成，请勿手工修改

SET NAMES utf8mb4;
USE linux_study;

-- ── 管理员 ──
INSERT INTO `admins` (`username`,`password_hash`,`name`,`role`) VALUES ('admin', 'scrypt$16384$8$1$7598e33be09bd69aa05813088bae6871$15dc36f2c0ceaa367dfcfa2a1f08e7426193ad39582168955b917b387bb3f92ba6cd6040fe0faaf771e376f6496fa719f72dfa02569c5c3aafb58e7e95395dc3', '管理员（教师）', 'super')
  ON DUPLICATE KEY UPDATE `password_hash`=VALUES(`password_hash`),`name`=VALUES(`name`),`role`=VALUES(`role`);

-- ── 学生名单（姓名 / 学号 / 班级 / 手机号 均可在后台修改）──
-- 会员类型：none 普通 week 周 month 月 year 年 forever 永久；member_expire_at 为 NULL 表示永久或未开通
INSERT INTO `students` (`username`,`password_hash`,`name`,`sno`,`class_name`,`phone`,`member_type`,`member_expire_at`,`member_started_at`,`status`) VALUES ('student1', 'scrypt$16384$8$1$93afa8c3519042c8f64d673d225ce1f8$fe7e86a43a243ea6f2ba371baf724a1e30972140d49bb72b295606a17ea867766dba9754cd08eed43c0a2d4adfa3815df809ada20a1cb18ff78530320f8d5946', '学生一', '2026001', '计算机应用 1 班', '13800000001', 'forever', NULL, NOW(), 1)
  ON DUPLICATE KEY UPDATE `password_hash`=VALUES(`password_hash`),`name`=VALUES(`name`),`sno`=VALUES(`sno`),`class_name`=VALUES(`class_name`),`phone`=VALUES(`phone`),`member_type`=VALUES(`member_type`),`member_expire_at`=VALUES(`member_expire_at`),`member_started_at`=VALUES(`member_started_at`),`status`=VALUES(`status`);
INSERT INTO `students` (`username`,`password_hash`,`name`,`sno`,`class_name`,`phone`,`member_type`,`member_expire_at`,`member_started_at`,`status`) VALUES ('student2', 'scrypt$16384$8$1$0c7c811c43231b6fb7691ac871c16e37$8192c978a1423b83cf32388bd27ea13d35d45e6222ac9c86400d3b7c5dbee168db42ba731e3faad8e7700526d2e5ca01a988cd40213e021ed4c258c17f2bad97', '学生二', '2026002', '计算机应用 1 班', '13800000002', 'year', DATE_ADD(NOW(), INTERVAL 365 DAY), NOW(), 1)
  ON DUPLICATE KEY UPDATE `password_hash`=VALUES(`password_hash`),`name`=VALUES(`name`),`sno`=VALUES(`sno`),`class_name`=VALUES(`class_name`),`phone`=VALUES(`phone`),`member_type`=VALUES(`member_type`),`member_expire_at`=VALUES(`member_expire_at`),`member_started_at`=VALUES(`member_started_at`),`status`=VALUES(`status`);
INSERT INTO `students` (`username`,`password_hash`,`name`,`sno`,`class_name`,`phone`,`member_type`,`member_expire_at`,`member_started_at`,`status`) VALUES ('student3', 'scrypt$16384$8$1$40baf93681c66bdc80ee47568d1fd972$6f2e810776bb683c35094196f76e52fb58f1d7e3b6420871413c816efeb8e3ca6ea769ff2a4cfb0f438db14c6b3999c0f9ba12e99126e31c65fdaafd1a37bf34', '学生三', '2026003', '计算机应用 1 班', '13800000003', 'none', NULL, NULL, 1)
  ON DUPLICATE KEY UPDATE `password_hash`=VALUES(`password_hash`),`name`=VALUES(`name`),`sno`=VALUES(`sno`),`class_name`=VALUES(`class_name`),`phone`=VALUES(`phone`),`member_type`=VALUES(`member_type`),`member_expire_at`=VALUES(`member_expire_at`),`member_started_at`=VALUES(`member_started_at`),`status`=VALUES(`status`);
INSERT INTO `students` (`username`,`password_hash`,`name`,`sno`,`class_name`,`phone`,`member_type`,`member_expire_at`,`member_started_at`,`status`) VALUES ('student4', 'scrypt$16384$8$1$f1269d7aa77b31f9b450f28449f207e7$399b4745b4b51b1ccc5e76d939fdcab5ab698438e89258eefb5835ccd03586a0059e6ef2b44ca18efbecb621790cba7064ad50f49336e6229b9e6b3aacbf5ea4', '学生四', '2026004', '计算机应用 2 班', '13800000004', 'week', DATE_ADD(NOW(), INTERVAL 2 DAY) + INTERVAL 3 HOUR, NOW(), 1)
  ON DUPLICATE KEY UPDATE `password_hash`=VALUES(`password_hash`),`name`=VALUES(`name`),`sno`=VALUES(`sno`),`class_name`=VALUES(`class_name`),`phone`=VALUES(`phone`),`member_type`=VALUES(`member_type`),`member_expire_at`=VALUES(`member_expire_at`),`member_started_at`=VALUES(`member_started_at`),`status`=VALUES(`status`);
INSERT INTO `students` (`username`,`password_hash`,`name`,`sno`,`class_name`,`phone`,`member_type`,`member_expire_at`,`member_started_at`,`status`) VALUES ('student5', 'scrypt$16384$8$1$f50628166d2a5b17af53c4f8950bf700$318c33617911bf521e773097e146580a84a893a40fff6e3f33e791ae71f2ecc01cadc7d98f70a3bc5747d5b32f5ea116cfdc952e01fc2def8b9ce513becf2e5f', '学生五', '2026005', '计算机应用 2 班', '13800000005', 'none', NULL, NULL, 0)
  ON DUPLICATE KEY UPDATE `password_hash`=VALUES(`password_hash`),`name`=VALUES(`name`),`sno`=VALUES(`sno`),`class_name`=VALUES(`class_name`),`phone`=VALUES(`phone`),`member_type`=VALUES(`member_type`),`member_expire_at`=VALUES(`member_expire_at`),`member_started_at`=VALUES(`member_started_at`),`status`=VALUES(`status`);

-- ── 会员定价（后台「会员管理 → 定价配置」可随时修改）──
-- 字段：code, label, price, days(0=永久), tagline, is_hot, perks
INSERT INTO `pricing` (`code`,`label`,`price`,`days`,`tagline`,`is_hot`,`perks`,`sort_order`) VALUES ('none', '普通会员', 0.00, 0, '免费体验', 0, '第一章学习权限｜不可打卡｜不可学习全部章节｜无法登录打卡平台', 10)
  ON DUPLICATE KEY UPDATE `label`=VALUES(`label`),`price`=VALUES(`price`),`days`=VALUES(`days`),`tagline`=VALUES(`tagline`),`is_hot`=VALUES(`is_hot`),`perks`=VALUES(`perks`);
INSERT INTO `pricing` (`code`,`label`,`price`,`days`,`tagline`,`is_hot`,`perks`,`sort_order`) VALUES ('week', '周会员', 4.00, 7, '短期冲刺｜7 天', 0, '可学习全章节内容｜可进行学习打卡｜专业团队出题练习｜可导出学习打卡记录', 20)
  ON DUPLICATE KEY UPDATE `label`=VALUES(`label`),`price`=VALUES(`price`),`days`=VALUES(`days`),`tagline`=VALUES(`tagline`),`is_hot`=VALUES(`is_hot`),`perks`=VALUES(`perks`);
INSERT INTO `pricing` (`code`,`label`,`price`,`days`,`tagline`,`is_hot`,`perks`,`sort_order`) VALUES ('month', '月会员', 12.00, 30, '最受欢迎｜30 天', 1, '可学习全章节内容｜可进行学习打卡｜专业团队出题练习｜可导出学习打卡记录', 30)
  ON DUPLICATE KEY UPDATE `label`=VALUES(`label`),`price`=VALUES(`price`),`days`=VALUES(`days`),`tagline`=VALUES(`tagline`),`is_hot`=VALUES(`is_hot`),`perks`=VALUES(`perks`);
INSERT INTO `pricing` (`code`,`label`,`price`,`days`,`tagline`,`is_hot`,`perks`,`sort_order`) VALUES ('year', '年会员', 24.00, 365, '超高性价比｜365 天', 0, '可学习全章节内容｜可进行学习打卡｜专业团队出题练习｜可导出学习打卡记录', 40)
  ON DUPLICATE KEY UPDATE `label`=VALUES(`label`),`price`=VALUES(`price`),`days`=VALUES(`days`),`tagline`=VALUES(`tagline`),`is_hot`=VALUES(`is_hot`),`perks`=VALUES(`perks`);
INSERT INTO `pricing` (`code`,`label`,`price`,`days`,`tagline`,`is_hot`,`perks`,`sort_order`) VALUES ('forever', '永久会员', 59.90, 0, '一次购买｜终身可用', 0, '可学习全章节内容｜可进行学习打卡｜专业团队出题练习｜可导出学习打卡记录', 50)
  ON DUPLICATE KEY UPDATE `label`=VALUES(`label`),`price`=VALUES(`price`),`days`=VALUES(`days`),`tagline`=VALUES(`tagline`),`is_hot`=VALUES(`is_hot`),`perks`=VALUES(`perks`);

-- ── 明文口令速查（首次登录后请在后台或数据库中修改）──
--   admin    / admin@2026
--   student1 / xiaoran2026  会员=forever
--   student2 / linux2026    会员=year
--   student3 / study2026    会员=none
--   student4 / buddy2026    会员=week
--   student5 / hello2026    会员=none（已禁用）
