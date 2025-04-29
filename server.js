// server.js
const express = require('express');
const http = require('http');
const socketIO = require('socket.io');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const app = express();
const server = http.createServer(app);
const io = socketIO(server);

// 정적 파일 제공
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 세션 설정
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite' }),
  secret: 'baccarat-game-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 } // 30일
}));

// 데이터베이스 설정
const db = new sqlite3.Database('./database.sqlite', (err) => {
  if (err) {
    console.error('Database connection error:', err.message);
  } else {
    console.log('Connected to the SQLite database');
    initializeDatabase();
  }
});

// 데이터베이스 초기화
function initializeDatabase() {
  db.serialize(() => {
    // 사용자 테이블
    db.run(`CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      balance REAL DEFAULT 1000.0,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0,
      profit REAL DEFAULT 0.0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    // 게임 히스토리 테이블
    db.run(`CREATE TABLE IF NOT EXISTS game_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      game_result TEXT NOT NULL,
      amount REAL NOT NULL,
      win_lose TEXT NOT NULL,
      player_score INTEGER NOT NULL,
      banker_score INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users (id)
    )`);
  });
}

// 사용자, 게임 데이터 저장
const onlinePlayers = {};
const games = {};

// API 라우트 - 회원가입
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ success: false, message: '사용자 이름과 비밀번호를 모두 입력해주세요.' });
  }

  try {
    // 사용자 이름 중복 확인
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
      if (err) {
        return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
      }
      
      if (user) {
        return res.status(400).json({ success: false, message: '이미 사용 중인 사용자 이름입니다.' });
      }
      
      // 비밀번호 해싱
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(password, salt);
      
      // 사용자 등록
      db.run('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword], function(err) {
        if (err) {
          return res.status(500).json({ success: false, message: '사용자 등록 중 오류가 발생했습니다.' });
        }
        
        res.status(201).json({
          success: true, 
          message: '회원가입이 완료되었습니다.',
          userId: this.lastID
        });
      });
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// API 라우트 - 로그인
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ success: false, message: '사용자 이름과 비밀번호를 모두 입력해주세요.' });
  }

  try {
    db.get('SELECT * FROM users WHERE username = ?', [username], async (err, user) => {
      if (err) {
        return res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
      }
      
      if (!user) {
        return res.status(400).json({ success: false, message: '사용자 이름 또는 비밀번호가 잘못되었습니다.' });
      }
      
      // 비밀번호 확인
      const isMatch = await bcrypt.compare(password, user.password);
      if (!isMatch) {
        return res.status(400).json({ success: false, message: '사용자 이름 또는 비밀번호가 잘못되었습니다.' });
      }
      
      // 세션에 사용자 정보 저장
      req.session.userId = user.id;
      req.session.username = user.username;
      
      res.status(200).json({ 
        success: true, 
        message: '로그인 성공',
        user: {
          id: user.id,
          username: user.username,
          balance: user.balance
        }
      });
    });
  } catch (error) {
    res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
  }
});

// API 라우트 - 로그아웃
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, message: '로그아웃 중 오류가 발생했습니다.' });
    }
    res.clearCookie('connect.sid');
    res.status(200).json({ success: true, message: '로그아웃 되었습니다.' });
  });
});

// API 라우트 - 사용자 히스토리 조회
app.get('/api/history', (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ success: false, message: '로그인이 필요합니다.' });
  }

  db.all(
    `SELECT * FROM game_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
    [req.session.userId],
    (err, history) => {
      if (err) {
        return res.status(500).json({ success: false, message: '히스토리 조회 중 오류가 발생했습니다.' });
      }
      
      res.status(200).json({ success: true, history });
    }
  );
});

// 소켓 연결 핸들링
io.on('connection', (socket) => {
  console.log('새로운 사용자가 연결되었습니다:', socket.id);
  
  // 유저 로그인
  socket.on('login', (userData) => {
    const username = userData.username;
    
    // 이미 로그인된 사용자인지 확인
    if (onlinePlayers[username]) {
      socket.emit('login_response', { 
        success: false, 
        message: '이미 접속 중인 사용자입니다.' 
      });
      return;
    }
    
    // 데이터베이스에서 사용자 정보 조회
    db.get('SELECT * FROM users WHERE username = ?', [username], (err, user) => {
      if (err) {
        socket.emit('login_response', { 
          success: false, 
          message: '서버 오류가 발생했습니다.' 
        });
        return;
      }
      
      if (!user) {
        socket.emit('login_response', { 
          success: false, 
          message: '등록되지 않은 사용자입니다. 회원가입을 해주세요.' 
        });
        return;
      }
      
      // 사용자 정보 업데이트
      socket.username = username;
      socket.userId = user.id;
      onlinePlayers[username] = {
        id: socket.id,
        userId: user.id,
        username: username,
        lastActive: Date.now()
      };
      
      // 히스토리 조회
      db.all(
        `SELECT game_result as result, amount, win_lose, player_score, banker_score, 
                datetime(created_at, 'localtime') as time 
         FROM game_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
        [user.id],
        (err, history) => {
          if (err) {
            console.error('History retrieval error:', err);
            history = [];
          }
          
          // 로그인 성공 응답
          socket.emit('login_response', { 
            success: true, 
            user: {
              id: user.id,
              username: user.username,
              balance: user.balance,
              history: history.map(h => `[${h.time.split(' ')[1]}] ${h.win_lose === 'win' ? '승리!' : '패배!'} ${h.win_lose === 'win' ? '+$' + h.amount.toFixed(2) : '-$' + h.amount} (P${h.player_score}:B${h.banker_score})`)
            }
          });
          
          // 모든 사용자에게 접속자 목록 업데이트 알림
          io.emit('online_players_update', Object.keys(onlinePlayers));
          
          // 랭킹 업데이트
          updateAndSendRankings();
        }
      );
    });
  });
  
  // 소켓 인증 확인
  socket.on('authenticate', (token) => {
    // 실제 구현에서는 JWT 토큰 검증 등을 수행
    // 이 예제에서는 생략
  });
  
  // 로그아웃
  socket.on('logout', () => {
    if (socket.username && onlinePlayers[socket.username]) {
      // 현재 사용자 정보 삭제
      delete onlinePlayers[socket.username];
      socket.username = null;
      socket.userId = null;
      
      // 모든 사용자에게 접속자 목록 업데이트 알림
      io.emit('online_players_update', Object.keys(onlinePlayers));
    }
  });
  
  // 베팅 시작
  socket.on('place_bet', (betData) => {
    if (!socket.username || !socket.userId) return;
    
    const { choice, amount } = betData;
    const username = socket.username;
    const userId = socket.userId;
    
    // 데이터베이스에서 현재 잔액 확인
    db.get('SELECT balance FROM users WHERE id = ?', [userId], (err, user) => {
      if (err || !user) {
        socket.emit('bet_response', { 
          success: false, 
          message: '사용자 정보를 불러올 수 없습니다.' 
        });
        return;
      }
      
      // 잔액 확인
      if (amount <= 0 || amount > user.balance) {
        socket.emit('bet_response', { 
          success: false, 
          message: '유효하지 않은 베팅 금액입니다.' 
        });
        return;
      }
      
      // 게임 ID 생성
      const gameId = `game_${username}_${Date.now()}`;
      
      // 게임 정보 저장
      games[gameId] = {
        id: gameId,
        userId: userId,
        player: username,
        choice: choice,
        bet: amount,
        status: 'started',
        time: Date.now()
      };
      
      // 모든 사용자에게 새 게임 알림
      io.emit('game_started', {
        gameId,
        player: username,
        choice,
        bet: amount
      });
      
      // 결과 계산 (1.5초 후에 결과 전송)
      setTimeout(() => {
        // 카드 생성 및 결과 계산
        const result = calculateGameResult(choice, amount);
        const { playerCards, bankerCards, playerScore, bankerScore, isWin, winAmount } = result;
        
        // 게임 결과 업데이트
        games[gameId] = {
          ...games[gameId],
          playerCards,
          bankerCards,
          playerScore,
          bankerScore,
          isWin,
          winAmount,
          status: 'completed'
        };
        
        // 데이터베이스 업데이트 (트랜잭션 사용)
        db.serialize(() => {
          db.run('BEGIN TRANSACTION');
          
          // 사용자 잔액 및 통계 업데이트
          db.run(
            `UPDATE users SET 
             balance = balance ${isWin ? '+' : '-'} ?, 
             ${isWin ? 'wins = wins + 1' : 'losses = losses + 1'}, 
             profit = profit ${isWin ? '+' : '-'} ? 
             WHERE id = ?`,
            [isWin ? winAmount : amount, isWin ? winAmount : amount, userId],
            function(err) {
              if (err) {
                console.error('Update user stats error:', err);
                db.run('ROLLBACK');
                socket.emit('error', { message: '게임 결과를 저장하는데 오류가 발생했습니다.' });
                return;
              }
              
              // 게임 히스토리 저장
              db.run(
                `INSERT INTO game_history 
                 (user_id, game_result, amount, win_lose, player_score, banker_score) 
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [userId, choice, isWin ? winAmount : amount, isWin ? 'win' : 'lose', playerScore, bankerScore],
                function(err) {
                  if (err) {
                    console.error('Insert history error:', err);
                    db.run('ROLLBACK');
                    socket.emit('error', { message: '게임 히스토리를 저장하는데 오류가 발생했습니다.' });
                    return;
                  }
                  
                  db.run('COMMIT');
                  
                  // 현재 잔액 조회
                  db.get('SELECT balance FROM users WHERE id = ?', [userId], (err, user) => {
                    const timeStr = new Date().toLocaleTimeString();
                    const historyItem = `[${timeStr}] ${isWin ? '승리!' : '패배!'} ${isWin ? '+$'+winAmount.toFixed(2) : '-$'+amount} (P${playerScore}:B${bankerScore})`;
                    
                    // 결과 전송
                    socket.emit('game_result', {
                      gameId,
                      playerCards,
                      bankerCards,
                      playerScore,
                      bankerScore,
                      isWin,
                      winAmount,
                      bet: amount,
                      newBalance: user ? user.balance : 0,
                      historyItem
                    });
                    
                    // 모든 사용자에게 게임 결과 알림
                    io.emit('game_completed', {
                      gameId,
                      player: username,
                      isWin,
                      playerScore,
                      bankerScore
                    });
                    
                    // 랭킹 데이터 계산 및 전송
                    updateAndSendRankings();
                  });
                }
              );
            }
          );
        });
      }, 1500); // 1.5초 후 결과 계산 (카드 애니메이션 처리 시간)
    });
  });
  
  // 채팅 메시지
  socket.on('chat_message', (message) => {
    if (!socket.username) return;
    
    // 모든 사용자에게 메시지 전달
    io.emit('chat_message', {
      sender: socket.username,
      message,
      time: Date.now()
    });
  });
  
  // 연결 종료
  socket.on('disconnect', () => {
    if (socket.username && onlinePlayers[socket.username]) {
      // 현재 사용자 정보 삭제
      delete onlinePlayers[socket.username];
      
      // 모든 사용자에게 접속자 목록 업데이트 알림
      io.emit('online_players_update', Object.keys(onlinePlayers));
    }
    console.log('사용자 연결이 종료되었습니다:', socket.id);
  });
});

// 랭킹 업데이트 및 전송 함수
function updateAndSendRankings() {
  db.all(
    `SELECT username, profit, wins, losses,
     CASE WHEN (wins + losses) > 0 THEN (wins * 100.0 / (wins + losses)) ELSE 0 END as win_rate
     FROM users
     ORDER BY profit DESC
     LIMIT 50`,
    [],
    (err, rankings) => {
      if (err) {
        console.error('Rankings query error:', err);
        return;
      }
      
      const formattedRankings = rankings.map(user => ({
        username: user.username,
        profit: user.profit || 0,
        games: (user.wins || 0) + (user.losses || 0),
        winRate: user.win_rate.toFixed(1)
      }));
      
      io.emit('rankings_update', formattedRankings);
    }
  );
}

// 게임 결과 계산 함수
function calculateGameResult(choice, amount) {
  // 카드 생성
  const playerCards = [drawCard(), drawCard()];
  const bankerCards = [drawCard(), drawCard()];
  
  // 초기 점수 계산
  let playerScore = calculateHandValue(playerCards);
  let bankerScore = calculateHandValue(bankerCards);
  
  // 추가 카드 규칙 적용
  if (playerScore <= 5) {
    playerCards.push(drawCard());
    playerScore = calculateHandValue(playerCards);
  }
  
  if (bankerScore <= 5) {
    bankerCards.push(drawCard());
    bankerScore = calculateHandValue(bankerCards);
  }
  
  // 승패 판정
  let isWin = false;
  let winAmount = 0;
  
  if ((playerScore > bankerScore && choice === 'player') || 
      (bankerScore > playerScore && choice === 'banker') || 
      (playerScore === bankerScore && choice === 'tie')) {
    isWin = true;
    if (choice === 'player') winAmount = amount;
    if (choice === 'banker') winAmount = amount * 0.95;
    if (choice === 'tie') winAmount = amount * 8;
  }
  
  return {
    playerCards,
    bankerCards,
    playerScore,
    bankerScore,
    isWin,
    winAmount
  };
}

// 카드 생성 함수
function drawCard() {
  const suits = ['hearts', 'diamonds', 'clubs', 'spades'];
  const values = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  const suit = suits[Math.floor(Math.random() * suits.length)];
  const value = values[Math.floor(Math.random() * values.length)];
  return { value, suit };
}

// 핸드 값 계산 함수
function calculateHandValue(hand) {
  let value = hand.reduce((sum, card) => {
    if (card.value === 'J' || card.value === 'Q' || card.value === 'K') return sum + 0;
    if (card.value === 'A') return sum + 1;
    return sum + parseInt(card.value);
  }, 0) % 10;
  
  return value;
}

// 서버 시작
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
  console.log(`접속 방법: http://localhost:${PORT} (본인)`);
  console.log(`네트워크 접속 방법: http://<your-local-ip>:${PORT} (친구들)`);
});