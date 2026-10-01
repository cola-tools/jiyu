-- Linux 学习打卡平台 · 账号初始化
-- 由 gen_seed.py 自动生成，请勿手工修改

SET NAMES utf8mb4;
USE linux_study;

-- ── 管理员 ──
INSERT INTO `admins` (`username`,`password_hash`,`name`,`role`) VALUES ('admin', 'scrypt$16384$8$1$79dce39c936bcbaa64841a9484765eb7$5be083e837550facc88f06df3ea914c4a8d9336d1f207c11c664af6d60447128e001a96ccfc665e555f3535637ccf7396ae0348d5295987480b470b76a69a8bf', '管理员（教师）', 'super')
  ON DUPLICATE KEY UPDATE `password_hash`=VALUES(`password_hash`),`name`=VALUES(`name`),`role`=VALUES(`role`);

-- ── 学生名单（姓名 / 学号 / 班级 / 联系电话 均可在后台修改）──
INSERT INTO `students` (`username`,`password_hash`,`name`,`sno`,`class_name`,`phone`) VALUES ('student1', 'scrypt$16384$8$1$b14ddf6d7b0025b4fb3dd3f4991d6b8e$6b81d4f2c07e7ee4447b819240350204b65acf204d35a99d1ee1436be37453ea05276f72be6d28f11b7eba6f4a8fc52b98a0610e9d5f202d4fb06a8f98684274', '学生一', '2026001', '计算机应用 1 班', '13800000001')
  ON DUPLICATE KEY UPDATE `password_hash`=VALUES(`password_hash`),`name`=VALUES(`name`),`sno`=VALUES(`sno`),`class_name`=VALUES(`class_name`),`phone`=VALUES(`phone`);
INSERT INTO `students` (`username`,`password_hash`,`name`,`sno`,`class_name`,`phone`) VALUES ('student2', 'scrypt$16384$8$1$eb22c533c70a8e002383d0664b5d56a8$218b0e46ff713fce520edab5cc14f425f7e7eace8809741107bdea2531deba12fb839ae319999b16b98fb2311c1875204e24a3ebc12b66d3f258249ba53b6078', '学生二', '2026002', '计算机应用 1 班', '13800000002')
  ON DUPLICATE KEY UPDATE `password_hash`=VALUES(`password_hash`),`name`=VALUES(`name`),`sno`=VALUES(`sno`),`class_name`=VALUES(`class_name`),`phone`=VALUES(`phone`);
INSERT INTO `students` (`username`,`password_hash`,`name`,`sno`,`class_name`,`phone`) VALUES ('student3', 'scrypt$16384$8$1$f09813524840f2fa1d2bf1dfd045c90b$7b41106eec4a38390e82441bc684904468231235bdd75b88cae8a561d6d16aaeee96624f4a8fcdc51b068280fd4f7d5703d2af59c83e1177e91d97698c444839', '学生三', '2026003', '计算机应用 1 班', '13800000003')
  ON DUPLICATE KEY UPDATE `password_hash`=VALUES(`password_hash`),`name`=VALUES(`name`),`sno`=VALUES(`sno`),`class_name`=VALUES(`class_name`),`phone`=VALUES(`phone`);
INSERT INTO `students` (`username`,`password_hash`,`name`,`sno`,`class_name`,`phone`) VALUES ('student4', 'scrypt$16384$8$1$f31027eed09ead911567bd2ea32edd73$6e5abae559cdda1d235b82512dad0518c8fe2afe5ebc05414f77496fb970097a12b6726f04893abef303d55183e63bfbd0bac6958bd26b70065e07b332c51eba', '学生四', '2026004', '计算机应用 2 班', '13800000004')
  ON DUPLICATE KEY UPDATE `password_hash`=VALUES(`password_hash`),`name`=VALUES(`name`),`sno`=VALUES(`sno`),`class_name`=VALUES(`class_name`),`phone`=VALUES(`phone`);
INSERT INTO `students` (`username`,`password_hash`,`name`,`sno`,`class_name`,`phone`) VALUES ('student5', 'scrypt$16384$8$1$2e082aa0c2627236a068809a2cee37d6$398eed7f1fcc2b5c04729e6db0397b8943ef5bdb01b028819878960096b11dcd87f0db2dbc28c5eb319fcbb60fb7fc52667f97fcf14747ef2d402f58cad02da5', '学生五', '2026005', '计算机应用 2 班', '13800000005')
  ON DUPLICATE KEY UPDATE `password_hash`=VALUES(`password_hash`),`name`=VALUES(`name`),`sno`=VALUES(`sno`),`class_name`=VALUES(`class_name`),`phone`=VALUES(`phone`);

-- ── 明文口令速查（首次登录后请在后台或数据库中修改）──
--   admin    / admin@2026
--   student1 / xiaoran2026
--   student2 / linux2026
--   student3 / study2026
--   student4 / buddy2026
--   student5 / hello2026
