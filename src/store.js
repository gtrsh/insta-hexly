const POST_WITH_AUTHOR = `
  SELECT p.id, p.image, p.caption, p.created_at AS createdAt,
         u.id AS authorId, u.username AS authorUsername, u.avatar AS authorAvatar,
         CASE WHEN f.follower_id IS NULL THEN 0 ELSE 1 END AS isFollowing
    FROM posts p
    JOIN users u ON u.id = p.user_id
    LEFT JOIN follows f ON f.followee_id = u.id AND f.follower_id = :viewerId
`;

export function createStore(db) {
  const stmt = {
    insertUser: db.prepare(`
      INSERT INTO users (username, email, password_hash, created_at)
      VALUES (:username, :email, :passwordHash, :createdAt)
    `),
    userById: db.prepare('SELECT id, username, email, avatar, created_at AS createdAt FROM users WHERE id = ?'),
    userByUsername: db.prepare('SELECT id, username, email, avatar, created_at AS createdAt FROM users WHERE username = ?'),
    userByLogin: db.prepare(`
      SELECT id, username, password_hash AS passwordHash FROM users
       WHERE username = :login OR email = :login
    `),
    usernameTaken: db.prepare('SELECT 1 FROM users WHERE username = ?'),
    emailTaken: db.prepare('SELECT 1 FROM users WHERE email = ?'),
    setAvatar: db.prepare('UPDATE users SET avatar = :avatar WHERE id = :id'),
    userStats: db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM posts   WHERE user_id     = :id) AS posts,
        (SELECT COUNT(*) FROM follows WHERE followee_id = :id) AS followers,
        (SELECT COUNT(*) FROM follows WHERE follower_id = :id) AS following
    `),

    insertSession: db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)'),
    sessionUser: db.prepare(`
      SELECT u.id, u.username, u.avatar
        FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = ? AND s.expires_at > ?
    `),
    deleteSession: db.prepare('DELETE FROM sessions WHERE id = ?'),
    deleteExpiredSessions: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),

    insertPost: db.prepare(`
      INSERT INTO posts (user_id, image, caption, created_at)
      VALUES (:userId, :image, :caption, :createdAt)
    `),
    postById: db.prepare(`${POST_WITH_AUTHOR} WHERE p.id = :id`),
    feed: db.prepare(`${POST_WITH_AUTHOR} ORDER BY p.created_at DESC, p.id DESC LIMIT :limit OFFSET :offset`),
    countPosts: db.prepare('SELECT COUNT(*) AS n FROM posts'),
    userPosts: db.prepare(`
      SELECT id, image, caption, created_at AS createdAt FROM posts
       WHERE user_id = :userId
       ORDER BY created_at DESC, id DESC
       LIMIT :limit OFFSET :offset
    `),
    latestImages: db.prepare('SELECT id, image FROM posts ORDER BY created_at DESC, id DESC LIMIT ?'),
    deletePost: db.prepare('DELETE FROM posts WHERE id = :id AND user_id = :userId'),

    follow: db.prepare(`
      INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at)
      VALUES (:followerId, :followeeId, :createdAt)
    `),
    unfollow: db.prepare('DELETE FROM follows WHERE follower_id = :followerId AND followee_id = :followeeId'),
    isFollowing: db.prepare('SELECT 1 FROM follows WHERE follower_id = :followerId AND followee_id = :followeeId'),
  };

  return {
    createUser({ username, email, passwordHash }) {
      const { lastInsertRowid } = stmt.insertUser.run({ username, email, passwordHash, createdAt: Date.now() });
      return Number(lastInsertRowid);
    },
    findUserById: (id) => stmt.userById.get(id),
    findUserByUsername: (username) => stmt.userByUsername.get(username),
    findUserForLogin: (login) => stmt.userByLogin.get({ login }),
    isUsernameTaken: (username) => Boolean(stmt.usernameTaken.get(username)),
    isEmailTaken: (email) => Boolean(stmt.emailTaken.get(email)),
    setAvatar: (id, avatar) => stmt.setAvatar.run({ id, avatar }),
    getUserStats: (id) => ({ ...stmt.userStats.get({ id }) }),

    createSession: (id, userId, expiresAt) => stmt.insertSession.run(id, userId, expiresAt),
    findSessionUser: (id) => stmt.sessionUser.get(id, Date.now()),
    deleteSession: (id) => stmt.deleteSession.run(id),
    purgeExpiredSessions: () => stmt.deleteExpiredSessions.run(Date.now()).changes,

    createPost({ userId, image, caption }) {
      const { lastInsertRowid } = stmt.insertPost.run({ userId, image, caption, createdAt: Date.now() });
      return Number(lastInsertRowid);
    },
    findPost: (id, viewerId = 0) => stmt.postById.get({ id, viewerId }),
    listFeed: ({ limit, offset, viewerId = 0 }) => stmt.feed.all({ limit, offset, viewerId }),
    countAllPosts: () => stmt.countPosts.get().n,
    listUserPosts: ({ userId, limit, offset }) => stmt.userPosts.all({ userId, limit, offset }),
    latestImages: (limit) => stmt.latestImages.all(limit),
    deletePost: (id, userId) => stmt.deletePost.run({ id, userId }).changes > 0,

    follow: (followerId, followeeId) =>
      stmt.follow.run({ followerId, followeeId, createdAt: Date.now() }).changes > 0,
    unfollow: (followerId, followeeId) => stmt.unfollow.run({ followerId, followeeId }).changes > 0,
    isFollowing: (followerId, followeeId) => Boolean(stmt.isFollowing.get({ followerId, followeeId })),
  };
}
