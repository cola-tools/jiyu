-- ═══════════════════════════════════════════════════════════════════════════
--  Linux 学习打卡平台 · MySQL 数据库结构
--  MySQL 5.7+ / 8.0+ / 9.x 兼容；字符集统一 utf8mb4
--
--  使用方法：
--      mysql -u root -p < schema.sql
--  或（云数据库，如 Railway / Aiven / 腾讯云）：
--      mysql -h <host> -P <port> -u <user> -p <dbname> < schema.sql
--
--  注意：若云端账号没有 CREATE DATABASE 权限（少数托管服务），
--        请删掉下面两行 CREATE DATABASE / USE，直接指定库名连接即可。
-- ═══════════════════════════════════════════════════════════════════════════

CREATE DATABASE IF NOT EXISTS `linux_study`
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE `linux_study`;

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. 用户体系
-- ─────────────────────────────────────────────────────────────────────────

-- 管理员（教师 / 运营）
CREATE TABLE IF NOT EXISTS `admins` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username`      VARCHAR(64)  NOT NULL COMMENT '登录账号',
  `password_hash` VARCHAR(255) NOT NULL COMMENT 'scrypt$N$r$p$salt$hash',
  `name`          VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '姓名',
  `role`          VARCHAR(32)  NOT NULL DEFAULT 'admin' COMMENT 'super|admin',
  `status`        TINYINT      NOT NULL DEFAULT 1 COMMENT '1启用 0禁用',
  `last_login_at` DATETIME     NULL,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_admin_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='管理员账号';

-- 学生名单（同时是学习平台的登录用户）
CREATE TABLE IF NOT EXISTS `students` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username`      VARCHAR(64)  NOT NULL COMMENT '登录账号（用户名）',
  `password_hash` VARCHAR(255) NOT NULL COMMENT 'scrypt$N$r$p$salt$hash',
  `name`          VARCHAR(64)  NOT NULL COMMENT '姓名 / 昵称',
  `sno`           VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '学号',
  `class_name`    VARCHAR(64)  NOT NULL DEFAULT '' COMMENT '班级',
  -- 手机号是账号唯一性约束：允许 NULL（历史数据/管理员代建账号），
  -- MySQL 的 UNIQUE 索引允许多行 NULL，因此不能改用 NOT NULL DEFAULT ''
  `phone`         VARCHAR(32)  NULL DEFAULT NULL COMMENT '手机号（账号唯一性约束）',
  `email`         VARCHAR(128) NOT NULL DEFAULT '',
  `remark`        VARCHAR(255) NOT NULL DEFAULT '' COMMENT '备注',
  `status`        TINYINT      NOT NULL DEFAULT 1 COMMENT '1允许使用 0已禁用',
  -- ── 会员体系 ──
  `member_type`   VARCHAR(16)  NOT NULL DEFAULT 'none'
                  COMMENT 'none普通会员 week周 month月 year年 forever永久',
  `member_expire_at` DATETIME  NULL
                  COMMENT '会员到期时刻；永久会员为 NULL，普通会员为 NULL',
  `member_started_at` DATETIME NULL COMMENT '最近一次开通/续费的时刻（到期时间起算基准）',
  `last_login_at` DATETIME     NULL,
  `created_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT '注册时间',
  `updated_at`    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_student_username` (`username`),
  UNIQUE KEY `uk_student_phone` (`phone`),
  KEY `idx_student_class` (`class_name`),
  KEY `idx_student_sno` (`sno`),
  KEY `idx_student_member` (`member_type`, `member_expire_at`),
  KEY `idx_student_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='学生名单（学习平台用户）';

-- 登录令牌（简单 Bearer Token，避免依赖 Redis / JWT 密钥管理）
CREATE TABLE IF NOT EXISTS `tokens` (
  `token`       CHAR(64)     NOT NULL COMMENT '随机 hex',
  `owner_type`  ENUM('admin','student') NOT NULL,
  `owner_id`    INT UNSIGNED NOT NULL,
  `expires_at`  DATETIME     NOT NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`token`),
  KEY `idx_token_owner` (`owner_type`, `owner_id`),
  KEY `idx_token_expire` (`expires_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='登录令牌';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. 学习内容目录树（管理员可在后台自由增删改）
--    level 1 主目录 → level 2 次目录 → level 3 学习目录 → level 4 学习内容
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `units` (
  `id`           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `parent_id`    INT UNSIGNED NULL COMMENT '父节点，NULL 为顶层',
  `level`        TINYINT      NOT NULL COMMENT '1主目录 2次目录 3学习目录 4学习内容',
  `title`        VARCHAR(200) NOT NULL COMMENT '标题',
  `summary`      VARCHAR(500) NOT NULL DEFAULT '' COMMENT '简介 / 说明',
  `content_type` VARCHAR(20)  NOT NULL DEFAULT 'text'
                 COMMENT 'text段落 code代码 table表格 note提示 list列表 cmd命令',
  `body`         MEDIUMTEXT   NULL COMMENT '正文（code/table 存 JSON 字符串）',
  `lang`         VARCHAR(20)  NOT NULL DEFAULT 'bash' COMMENT '代码语言',
  `example`      VARCHAR(500) NOT NULL DEFAULT '' COMMENT '速查举例（命令类）',
  `difficulty`   TINYINT      NOT NULL DEFAULT 1 COMMENT '1入门 2基础 3进阶 4高级',
  `sort_order`   INT          NOT NULL DEFAULT 0 COMMENT '同级排序',
  `is_checkable` TINYINT      NOT NULL DEFAULT 1 COMMENT '是否可打卡（目录级通常为 0）',
  `is_free`      TINYINT      NOT NULL DEFAULT 0
                 COMMENT '是否对普通会员免费开放：1免费 0需超级会员（仅 level<=2 的章节节点有意义，子级继承父级）',
  `status`       TINYINT      NOT NULL DEFAULT 1 COMMENT '1正常 0隐藏',
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_unit_parent` (`parent_id`, `sort_order`),
  KEY `idx_unit_level` (`level`),
  KEY `idx_unit_status` (`status`),
  CONSTRAINT `fk_unit_parent` FOREIGN KEY (`parent_id`) REFERENCES `units` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='学习目录与内容';

-- ─────────────────────────────────────────────────────────────────────────
-- 3. 打卡
-- ─────────────────────────────────────────────────────────────────────────

-- 当前有效打卡（一名学生对一个单元至多一条有效记录）
CREATE TABLE IF NOT EXISTS `checkins` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `student_id`   INT UNSIGNED NOT NULL,
  `unit_id`      INT UNSIGNED NOT NULL,
  `checkin_date` DATE         NOT NULL COMMENT '学生选择的打卡日期',
  `status`       ENUM('done','revoked') NOT NULL DEFAULT 'done',
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_checkin` (`student_id`, `unit_id`),
  KEY `idx_checkin_unit` (`unit_id`),
  KEY `idx_checkin_date` (`checkin_date`),
  KEY `idx_checkin_status` (`status`),
  CONSTRAINT `fk_checkin_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_checkin_unit` FOREIGN KEY (`unit_id`) REFERENCES `units` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='打卡记录（当前状态）';

-- 打卡流水（不可变，用于后台"实时动态"与"已撤销打卡"提示）
CREATE TABLE IF NOT EXISTS `checkin_logs` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `student_id` INT UNSIGNED NOT NULL,
  `unit_id`    INT UNSIGNED NOT NULL,
  `action`     ENUM('checkin','revoke','update') NOT NULL COMMENT '动作',
  `prev_date`  DATE         NULL COMMENT '变更前日期',
  `new_date`   DATE         NULL COMMENT '变更后日期',
  `unit_title` VARCHAR(200) NOT NULL DEFAULT '' COMMENT '冗余标题，单元被删也能追溯',
  `unit_path`  VARCHAR(500) NOT NULL DEFAULT '' COMMENT '冗余路径',
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_log_student` (`student_id`, `created_at`),
  KEY `idx_log_created` (`created_at`),
  CONSTRAINT `fk_log_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='打卡流水（含撤销）';

-- ─────────────────────────────────────────────────────────────────────────
-- 4. 督促（管理员 → 学生）
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `urges` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `admin_id`   INT UNSIGNED NOT NULL,
  `unit_id`    INT UNSIGNED NULL COMMENT '指定章节（可空＝纯留言）',
  `unit_path`  VARCHAR(500) NOT NULL DEFAULT '' COMMENT '章节完整路径',
  `title`      VARCHAR(200) NOT NULL DEFAULT '' COMMENT '督促标题',
  `message`    TEXT         NULL COMMENT '管理员自定义留言',
  `deadline`   DATETIME     NULL COMMENT '截止时间',
  `priority`   TINYINT      NOT NULL DEFAULT 1 COMMENT '1普通 2重要 3紧急',
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_urge_admin` (`admin_id`),
  KEY `idx_urge_deadline` (`deadline`),
  CONSTRAINT `fk_urge_admin` FOREIGN KEY (`admin_id`) REFERENCES `admins` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_urge_unit` FOREIGN KEY (`unit_id`) REFERENCES `units` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='督促任务';

-- 督促投递（一个督促可发给多名学生，逐个跟踪已读/完成）
CREATE TABLE IF NOT EXISTS `urge_targets` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `urge_id`    BIGINT UNSIGNED NOT NULL,
  `student_id` INT UNSIGNED NOT NULL,
  `read_at`    DATETIME NULL COMMENT '学生已读时间',
  `done_at`    DATETIME NULL COMMENT '学生完成时间',
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_urge_student` (`urge_id`, `student_id`),
  KEY `idx_target_student` (`student_id`, `read_at`),
  CONSTRAINT `fk_target_urge` FOREIGN KEY (`urge_id`) REFERENCES `urges` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_target_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='督促投递记录';

-- ─────────────────────────────────────────────────────────────────────────
-- 5. 题库与答题（管理员按学习目录出题）
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `questions` (
  `id`         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `unit_id`    INT UNSIGNED NULL COMMENT '归属的学习目录（章节）',
  `type`       ENUM('single','multiple','judge','fill','short') NOT NULL DEFAULT 'single',
  `stem`       TEXT         NOT NULL COMMENT '题干',
  `options`    TEXT         NULL COMMENT '选项 JSON：["A选项","B选项"]',
  `answer`     VARCHAR(500) NOT NULL DEFAULT '' COMMENT '答案：单选"A"；多选"AB"；判断"1/0"；填空/简答为参考答案',
  `analysis`   TEXT         NULL COMMENT '解析',
  `difficulty` TINYINT      NOT NULL DEFAULT 2,
  `score`      INT          NOT NULL DEFAULT 5 COMMENT '分值',
  `status`     TINYINT      NOT NULL DEFAULT 1,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_q_unit` (`unit_id`),
  CONSTRAINT `fk_q_unit` FOREIGN KEY (`unit_id`) REFERENCES `units` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='题库';

CREATE TABLE IF NOT EXISTS `answers` (
  `id`             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `student_id`     INT UNSIGNED NOT NULL,
  `question_id`    INT UNSIGNED NOT NULL,
  `student_answer` VARCHAR(500) NOT NULL DEFAULT '',
  `is_correct`     TINYINT      NOT NULL DEFAULT 0,
  `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_answer` (`student_id`, `question_id`),
  KEY `idx_answer_q` (`question_id`),
  CONSTRAINT `fk_answer_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_answer_q` FOREIGN KEY (`question_id`) REFERENCES `questions` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='学生答题记录';

-- ─────────────────────────────────────────────────────────────────────────
-- 6. 系统日志（后台"实时动态"聚合用）
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `activity` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `actor_type` ENUM('admin','student','system') NOT NULL,
  `actor_id`   INT UNSIGNED NULL,
  `actor_name` VARCHAR(64)  NOT NULL DEFAULT '',
  `action`     VARCHAR(64)  NOT NULL COMMENT 'checkin/revoke/login/urge/unit_add/unit_update/unit_delete/...',
  `target`     VARCHAR(255) NOT NULL DEFAULT '',
  `detail`     VARCHAR(500) NOT NULL DEFAULT '',
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_act_created` (`created_at`),
  KEY `idx_act_actor` (`actor_type`, `actor_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='操作动态流水';

-- ─────────────────────────────────────────────────────────────────────────
-- 7. 会员体系 / 注册验证
--    会员类型：none 普通会员（0 元）｜week 周｜month 月｜year 年｜forever 永久
--    到期规则：以「设置时刻」为起算基准，续费叠加 = max(当前时刻, 原到期时刻) + 时长
-- ─────────────────────────────────────────────────────────────────────────

-- 会员定价（后台可改）
CREATE TABLE IF NOT EXISTS `pricing` (
  `code`       VARCHAR(16)  NOT NULL COMMENT 'none/week/month/year/forever',
  `label`      VARCHAR(32)  NOT NULL COMMENT '周会员 / 月会员 / 年会员 / 永久会员',
  `price`      DECIMAL(10,2) NOT NULL DEFAULT 0.00 COMMENT '价格（元）',
  `days`       INT          NOT NULL DEFAULT 0 COMMENT '有效天数；0 表示永久（不设到期时间）',
  `perks`      VARCHAR(500) NOT NULL DEFAULT '' COMMENT '功能权益说明（｜分隔）',
  `tagline`    VARCHAR(120) NOT NULL DEFAULT '' COMMENT '副标题',
  `is_hot`     TINYINT      NOT NULL DEFAULT 0 COMMENT '是否推荐档位',
  `enabled`    TINYINT      NOT NULL DEFAULT 1 COMMENT '1上架 0下架',
  `sort_order` INT          NOT NULL DEFAULT 0,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='会员定价';

-- 短信验证码（注册 / 忘记密码）
CREATE TABLE IF NOT EXISTS `sms_codes` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `phone`      VARCHAR(32)  NOT NULL,
  `code`       VARCHAR(8)   NOT NULL COMMENT '6 位数字',
  `scene`      VARCHAR(16)  NOT NULL DEFAULT 'register' COMMENT 'register|forgot',
  `expire_at`  DATETIME     NOT NULL COMMENT '有效期（默认 5 分钟）',
  `used_at`    DATETIME     NULL COMMENT '核销时间，非空表示已使用',
  `send_count` INT          NOT NULL DEFAULT 1 COMMENT '同码重发次数',
  `request_ip` VARCHAR(64)  NOT NULL DEFAULT '',
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_sms_phone` (`phone`, `scene`, `created_at`),
  KEY `idx_sms_expire` (`expire_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='短信验证码';

-- 图形验证码（服务端生成 SVG，答案只存服务端）
CREATE TABLE IF NOT EXISTS `captcha_codes` (
  `token`      CHAR(32)     NOT NULL COMMENT '一次性票据，前端回传',
  `answer`     VARCHAR(16)  NOT NULL COMMENT '正确答案（小写）',
  `expire_at`  DATETIME     NOT NULL COMMENT '有效期（默认 5 分钟）',
  `used_at`    DATETIME     NULL,
  `request_ip` VARCHAR(64)  NOT NULL DEFAULT '',
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`token`),
  KEY `idx_captcha_expire` (`expire_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='图形验证码';

-- 会员变更流水（开通 / 续费 / 到期降级 / 禁用启用）
CREATE TABLE IF NOT EXISTS `member_logs` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `student_id`   INT UNSIGNED NOT NULL,
  `action`       VARCHAR(16)  NOT NULL
                 COMMENT 'grant开通 renew续费 expire到期降级 disable禁用 enable启用 admin_only',
  `type_from`    VARCHAR(16)  NOT NULL DEFAULT '' COMMENT '变更前会员类型',
  `type_to`      VARCHAR(16)  NOT NULL DEFAULT '',
  `expire_from`  DATETIME     NULL COMMENT '变更前到期时刻',
  `expire_to`    DATETIME     NULL COMMENT '变更后到期时刻（NULL = 永久）',
  `days_added`   INT          NOT NULL DEFAULT 0 COMMENT '本次新增天数',
  `operator_type` ENUM('admin','system') NOT NULL DEFAULT 'admin',
  `operator_id`  INT UNSIGNED NULL COMMENT '管理员 id',
  `operator_name` VARCHAR(64) NOT NULL DEFAULT '',
  `remark`       VARCHAR(255) NOT NULL DEFAULT '',
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_mlog_student` (`student_id`, `created_at`),
  KEY `idx_mlog_created` (`created_at`),
  CONSTRAINT `fk_mlog_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='会员变更流水';

-- 打卡记录导出流水
CREATE TABLE IF NOT EXISTS `export_logs` (
  `id`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `student_id` INT UNSIGNED NOT NULL,
  `format`     VARCHAR(8)   NOT NULL COMMENT 'csv|xlsx|pdf',
  `rows`       INT          NOT NULL DEFAULT 0,
  `date_from`  DATE         NULL,
  `date_to`    DATE         NULL,
  `request_ip` VARCHAR(64)  NOT NULL DEFAULT '',
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_exp_student` (`student_id`, `created_at`),
  CONSTRAINT `fk_exp_student` FOREIGN KEY (`student_id`) REFERENCES `students` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='打卡记录导出流水';

SET FOREIGN_KEY_CHECKS = 1;
