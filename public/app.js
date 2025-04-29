// 소켓 연결
const socket = io();

// DOM 요소 - 인증 화면
const authScreen = document.getElementById('auth-screen');
const loginTabBtn = document.getElementById('login-tab-btn');
const registerTabBtn = document.getElementById('register-tab-btn');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const loginUsername = document.getElementById('login-username');
const loginPassword = document.getElementById('login-password');
const loginBtn = document.getElementById('login-btn');
const loginError = document.getElementById('login-error');
const registerUsername = document.getElementById('register-username');
const registerPassword = document.getElementById('register-password');
const registerConfirmPassword = document.getElementById('register-confirm-password');
const registerBtn = document.getElementById('register-btn');
const registerError = document.getElementById('register-error');
const registerSuccess = document.getElementById('register-success');

// DOM 요소 - 게임 화면
const gameScreen = document.getElementById('game-screen');
const userNameDisplay = document.getElementById('user-name');
const userBalanceDisplay = document.getElementById('user-balance');
const logoutBtn = document.getElementById('logout-btn');
const playerCards = document.getElementById('player-cards');
const bankerCards = document.getElementById('banker-cards');
const playerScore = document.getElementById('player-score');
const bankerScore = document.getElementById('banker-score');
const gameStatus = document.getElementById('game-status');
const betOptions = document.querySelectorAll('.bet-btn');
const betAmount = document.getElementById('bet-amount');
const placeBetBtn = document.getElementById('place-bet-btn');
const historyList = document.getElementById('history-list');
const rankingsBody = document.getElementById('rankings-body');
const onlinePlayersList = document.getElementById('online-players-list');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');

// 게임 상태
let currentUser = null;
let selectedBet = null;
let isGameInProgress = false;

// 페이지 로드 시 이벤트 리스너 설정
document.addEventListener('DOMContentLoaded', () => {
    // 탭 전환 이벤트
    loginTabBtn.addEventListener('click', () => {
        loginTabBtn.classList.add('active');
        registerTabBtn.classList.remove('active');
        loginForm.classList.remove('hidden');
        registerForm.classList.add('hidden');
        clearFormMessages();
    });

    registerTabBtn.addEventListener('click', () => {
        registerTabBtn.classList.add('active');
        loginTabBtn.classList.remove('active');
        registerForm.classList.remove('hidden');
        loginForm.classList.add('hidden');
        clearFormMessages();
    });

    // 로그인 이벤트
    loginBtn.addEventListener('click', handleLogin);
    loginUsername.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') loginPassword.focus();
    });
    loginPassword.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleLogin();
    });

    // 회원가입 이벤트
    registerBtn.addEventListener('click', handleRegister);
    registerConfirmPassword.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') handleRegister();
    });

    // 로그아웃 이벤트
    logoutBtn.addEventListener('click', handleLogout);

    // 베팅 선택 이벤트
    betOptions.forEach(btn => {
        btn.addEventListener('click', () => {
            betOptions.forEach(b => b.classList.remove('selected'));
            btn.classList.add('selected');
            selectedBet = btn.dataset.choice;
            updateBetUI();
        });
    });

    // 베팅 금액 이벤트
    betAmount.addEventListener('input', updateBetUI);

    // 베팅 확정 이벤트
    placeBetBtn.addEventListener('click', handlePlaceBet);

    // 채팅 이벤트
    sendChatBtn.addEventListener('click', sendChatMessage);
    chatInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendChatMessage();
    });

    // 소켓 이벤트 리스너 설정
    setupSocketListeners();
});

// 소켓 이벤트 리스너 설정
function setupSocketListeners() {
    // 로그인 응답
    socket.on('login_response', (data) => {
        if (data.success) {
            currentUser = data.user;
            showGameScreen();
            updateUserInfo();
            clearFormInputs();
        } else {
            loginError.textContent = data.message;
        }
    });

    // 온라인 플레이어 업데이트
    socket.on('online_players_update', (players) => {
        updateOnlinePlayers(players);
    });

    // 랭킹 업데이트
    socket.on('rankings_update', (rankings) => {
        updateRankings(rankings);
    });

    // 게임 시작
    socket.on('game_started', (gameData) => {
        if (gameData.player === currentUser.username) {
            // 내 게임이 시작되면 UI 업데이트
            isGameInProgress = true;
            gameStatus.textContent = '게임 진행중...';
            placeBetBtn.disabled = true;
        }
    });

    // 게임 결과
    socket.on('game_result', (result) => {
        if (result.gameId.includes(currentUser.username)) {
            // 내 게임 결과 처리
            displayGameResult(result);
            // 사용자 정보 업데이트
            currentUser.balance = result.newBalance;
            updateUserInfo();
            // 히스토리 업데이트
            updateHistory(result.historyItem);
            // 게임 상태 초기화
            setTimeout(() => {
                resetGameState();
            }, 3000);
        }
    });

    // 다른 사람의 게임 결과
    socket.on('game_completed', (data) => {
        // 채팅 영역에 결과 알림
        const resultMessage = `${data.player}님의 게임 결과: ${data.isWin ? '승리!' : '패배!'} (P${data.playerScore}:B${data.bankerScore})`;
        addSystemMessage(resultMessage);
    });

    // 채팅 메시지
    socket.on('chat_message', (message) => {
        addChatMessage(message);
    });

    // 서버 에러 메시지
    socket.on('error', (data) => {
        alert(data.message);
    });
}

// 로그인 처리
function handleLogin() {
    const username = loginUsername.value.trim();
    const password = loginPassword.value.trim();
    
    if (!username || !password) {
        loginError.textContent = '사용자 이름과 비밀번호를 모두 입력해주세요.';
        return;
    }

    // Ajax 요청으로 로그인
    fetch('/api/login', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            // 로그인 성공 후 소켓 연결로 상태 업데이트
            socket.emit('login', { username });
        } else {
            loginError.textContent = data.message;
        }
    })
    .catch(error => {
        loginError.textContent = '서버 연결 중 오류가 발생했습니다.';
        console.error('Login error:', error);
    });
}

// 회원가입 처리
function handleRegister() {
    const username = registerUsername.value.trim();
    const password = registerPassword.value.trim();
    const confirmPassword = registerConfirmPassword.value.trim();
    
    // 입력 검증
    if (!username || !password || !confirmPassword) {
        registerError.textContent = '모든 필드를 입력해주세요.';
        return;
    }
    
    if (password !== confirmPassword) {
        registerError.textContent = '비밀번호가 일치하지 않습니다.';
        return;
    }
    
    // 회원가입 요청
    fetch('/api/register', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            registerSuccess.textContent = data.message;
            registerError.textContent = '';
            // 성공 후 폼 초기화
            registerUsername.value = '';
            registerPassword.value = '';
            registerConfirmPassword.value = '';
            
            // 3초 후 로그인 탭으로 자동 전환
            setTimeout(() => {
                loginTabBtn.click();
                loginUsername.value = username; // 사용자 편의를 위해 아이디 자동 입력
            }, 3000);
        } else {
            registerError.textContent = data.message;
            registerSuccess.textContent = '';
        }
    })
    .catch(error => {
        registerError.textContent = '서버 연결 중 오류가 발생했습니다.';
        registerSuccess.textContent = '';
        console.error('Register error:', error);
    });
}

// 로그아웃 처리
function handleLogout() {
    fetch('/api/logout', {
        method: 'POST',
    })
    .then(response => response.json())
    .then(data => {
        if (data.success) {
            socket.emit('logout');
            currentUser = null;
            selectedBet = null;
            showAuthScreen();
        } else {
            alert('로그아웃 처리 중 오류가 발생했습니다.');
        }
    })
    .catch(error => {
        console.error('Logout error:', error);
        alert('서버 연결 중 오류가 발생했습니다.');
    });
}

// 베팅 처리
function handlePlaceBet() {
    if (!selectedBet || isGameInProgress) return;

    const amount = parseInt(betAmount.value);
    if (isNaN(amount) || amount <= 0 || amount > currentUser.balance) {
        alert('유효한 베팅 금액을 입력해주세요.');
        return;
    }

    // 베팅 요청 전송
    socket.emit('place_bet', {
        choice: selectedBet,
        amount: amount
    });

    // UI 업데이트
    clearCards();
    isGameInProgress = true;
    placeBetBtn.disabled = true;
}

// 게임 상태 초기화
function resetGameState() {
    isGameInProgress = false;
    gameStatus.textContent = '베팅을 선택하세요';
    placeBetBtn.disabled = false;
    clearCards();
    playerScore.textContent = '';
    bankerScore.textContent = '';
    updateBetUI();
}

// 게임 결과 표시
function displayGameResult(result) {
    // 카드 표시
    displayCards(playerCards, result.playerCards);
    displayCards(bankerCards, result.bankerCards);
    
    // 점수 표시
    playerScore.textContent = `점수: ${result.playerScore}`;
    bankerScore.textContent = `점수: ${result.bankerScore}`;
    
    // 결과 표시
    if (result.isWin) {
        gameStatus.textContent = `승리! +$${result.winAmount.toFixed(2)}`;
        gameStatus.style.backgroundColor = '#27ae60';
    } else {
        gameStatus.textContent = `패배! -$${result.bet}`;
        gameStatus.style.backgroundColor = '#e74c3c';
    }
    
    // 원래 배경색으로 복귀 (3초 후)
    setTimeout(() => {
        gameStatus.style.backgroundColor = '';
    }, 3000);
}

// 카드 표시
function displayCards(container, cards) {
    container.innerHTML = '';
    
    cards.forEach((card, index) => {
        const cardElement = document.createElement('div');
        cardElement.className = `card ${card.suit} dealt`;
        cardElement.style.animationDelay = `${index * 0.2}s`; // 카드별 애니메이션 딜레이
        
        const valueElement = document.createElement('div');
        valueElement.className = 'card-value';
        valueElement.textContent = getCardDisplayValue(card.value);
        
        const suitElement = document.createElement('div');
        suitElement.className = 'card-suit';
        suitElement.innerHTML = getSuitSymbol(card.suit);
        
        cardElement.appendChild(valueElement);
        cardElement.appendChild(suitElement);
        container.appendChild(cardElement);
    });
}

// 카드 지우기
function clearCards() {
    playerCards.innerHTML = '';
    bankerCards.innerHTML = '';
}

// 카드 값 표시
function getCardDisplayValue(value) {
    if (value === 'A') return 'A';
    if (value === 'J') return 'J';
    if (value === 'Q') return 'Q';
    if (value === 'K') return 'K';
    return value;
}

// 카드 문양 심볼
function getSuitSymbol(suit) {
    switch (suit) {
        case 'hearts': return '♥';
        case 'diamonds': return '♦';
        case 'clubs': return '♣';
        case 'spades': return '♠';
        default: return '';
    }
}

// 베팅 UI 업데이트
function updateBetUI() {
    const amount = parseInt(betAmount.value);
    const validAmount = !isNaN(amount) && amount > 0 && 
                       (!currentUser || amount <= currentUser.balance);
    
    placeBetBtn.disabled = !selectedBet || !validAmount || isGameInProgress;
}

// 사용자 정보 업데이트
function updateUserInfo() {
    if (currentUser) {
        userNameDisplay.textContent = currentUser.username;
        userBalanceDisplay.textContent = `잔액: $${currentUser.balance.toFixed(2)}`;
        
        // 히스토리 업데이트
        updateHistoryList();
    }
}

// 히스토리 업데이트
function updateHistoryList() {
    historyList.innerHTML = '';
    
    if (currentUser && currentUser.history) {
        currentUser.history.forEach(item => {
            const li = document.createElement('li');
            li.textContent = item;
            historyList.appendChild(li);
        });
    }
}

// 히스토리 항목 추가
function updateHistory(historyItem) {
    if (!currentUser.history) currentUser.history = [];
    currentUser.history.unshift(historyItem);
    if (currentUser.history.length > 50) currentUser.history.pop();
    updateHistoryList();
}

// 랭킹 업데이트
function updateRankings(rankings) {
    rankingsBody.innerHTML = '';
    
    rankings.forEach((player, index) => {
        const row = document.createElement('tr');
        
        const rankCell = document.createElement('td');
        rankCell.textContent = index + 1;
        
        const nameCell = document.createElement('td');
        nameCell.textContent = player.username;
        if (currentUser && player.username === currentUser.username) {
            nameCell.style.fontWeight = 'bold';
        }
        
        const profitCell = document.createElement('td');
        profitCell.textContent = `$${player.profit.toFixed(2)}`;
        profitCell.style.color = player.profit >= 0 ? '#27ae60' : '#e74c3c';
        
        const winRateCell = document.createElement('td');
        winRateCell.textContent = `${player.winRate}%`;
        
        row.appendChild(rankCell);
        row.appendChild(nameCell);
        row.appendChild(profitCell);
        row.appendChild(winRateCell);
        
        rankingsBody.appendChild(row);
    });
}

// 온라인 플레이어 업데이트
function updateOnlinePlayers(players) {
    onlinePlayersList.innerHTML = '';
    
    players.forEach(player => {
        const li = document.createElement('li');
        li.textContent = player;
        if (currentUser && player === currentUser.username) {
            li.style.fontWeight = 'bold';
        }
        onlinePlayersList.appendChild(li);
    });
}

// 채팅 메시지 전송
function sendChatMessage() {
    const message = chatInput.value.trim();
    if (!message) return;
    
    socket.emit('chat_message', message);
    chatInput.value = '';
}

// 채팅 메시지 추가
function addChatMessage(message) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message';
    
    const senderSpan = document.createElement('span');
    senderSpan.className = 'sender';
    senderSpan.textContent = message.sender + ': ';
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'time';
    timeSpan.textContent = new Date(message.time).toLocaleTimeString();
    
    const contentSpan = document.createElement('span');
    contentSpan.className = 'content';
    contentSpan.textContent = message.message;
    
    messageDiv.appendChild(senderSpan);
    messageDiv.appendChild(timeSpan);
    messageDiv.appendChild(contentSpan);
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 시스템 메시지 추가
function addSystemMessage(text) {
    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message system-message';
    
    const contentSpan = document.createElement('span');
    contentSpan.className = 'content';
    contentSpan.textContent = text;
    
    messageDiv.appendChild(contentSpan);
    
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 인증 화면 표시
function showAuthScreen() {
    gameScreen.classList.add('hidden');
    authScreen.classList.remove('hidden');
}

// 게임 화면 표시
function showGameScreen() {
    authScreen.classList.add('hidden');
    gameScreen.classList.remove('hidden');
}

// 폼 메시지 초기화
function clearFormMessages() {
    loginError.textContent = '';
    registerError.textContent = '';
    registerSuccess.textContent = '';
}

// 폼 입력 초기화
function clearFormInputs() {
    loginUsername.value = '';
    loginPassword.value = '';
    registerUsername.value = '';
    registerPassword.value = '';
    registerConfirmPassword.value = '';
}