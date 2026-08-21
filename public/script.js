(function(){
  const DAYS = [
    {key:'SEG', abbr:'SEG', full:'Segunda-feira', color:'#7C5CBF'},
    {key:'TER', abbr:'TER', full:'Terça-feira',   color:'#4C7A6B'},
    {key:'QUA', abbr:'QUA', full:'Quarta-feira',  color:'#2B2A28'},
    {key:'QUI', abbr:'QUI', full:'Quinta-feira',  color:'#E1783E'},
    {key:'SEX', abbr:'SEX', full:'Sexta-feira',   color:'#D6588F'},
  ];

  const DEFAULT_LOCAIS = ['SALA DE REFERÊNCIA','QUADRA','PÁTIO','REFEITÓRIO','CIRCUITO','HORTA','AZULEJO','ESTACIONAMENTO','RUA','PASSEIO','PARQUE','SALA MULTIUSO','CORREDOR LATERAL','QUINTAIS BRINCANTES'];
  const DEFAULT_PROPOSTAS = ['Corpo e Movimento','Arte','Leitura','Roda de conversa','Aula de Música','Experiência Científica','Culinária','Degustação','Brincadeira Livre','Contextos de Aprendizagem','Brincadeira Dirigida','Brincadeira Simbólica','Leitura Simultânea','Aniversariante do Dia','Aniversariante do Mês','Escovação','Almoço','Lanche da Manhã','Lanche da Tarde','Vídeo','Calendário','Cardápio','Linha do tempo','Chamadinha','Chegada','Saída',];
  const BADGE_PALETTE = ['#E1783E','#D6588F','#7C5CBF','#4C7A6B','#3E7CB1','#C9A227','#B24C3E','#5C8A72'];

  let optionsCache = { locais: [...DEFAULT_LOCAIS], atividades: [...DEFAULT_PROPOSTAS] };
  let currentWeekData = {}; // {SEG:[{id,start,end,local,atividades:[],texto}], ...}
  let storageOK = true;

  const els = {
    weekPicker: document.getElementById('weekPicker'),
    prevWeek: document.getElementById('prevWeek'),
    nextWeek: document.getElementById('nextWeek'),
    rangeLabel: document.getElementById('rangeLabel'),
    duplicateBtn: document.getElementById('duplicateBtn'),
    printBtn: document.getElementById('printBtn'),
    daysContainer: document.getElementById('daysContainer'),
    saveDot: document.getElementById('saveDot'),
    saveText: document.getElementById('saveText'),
  };

  // ---------- date / week helpers ----------
  function pad(n){ return String(n).padStart(2,'0'); }

  function fmtDate(d) {
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}`;
}

  function isoWeekString(date) {

  const d = new Date(Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate()
  ));

  const dayNum = d.getUTCDay() || 7;

  d.setUTCDate(
    d.getUTCDate() + 4 - dayNum
  );

  const yearStart = new Date(
    Date.UTC(d.getUTCFullYear(), 0, 1)
  );

  const weekNo = Math.ceil(
    (
      (
        d - yearStart
      ) / 86400000 + 1
    ) / 7
  );

  return (
    d.getUTCFullYear() +
    '-W' +
    String(weekNo).padStart(2, '0')
  );
}


function mondayFromWeekString(weekStr) {

  const partes = weekStr.split('-W');

  const ano = Number(partes[0]);
  const semana = Number(partes[1]);

  const dia4Janeiro =
    new Date(Date.UTC(ano, 0, 4));

  const diaSemana =
    dia4Janeiro.getUTCDay() || 7;

  const primeiraSegunda =
    new Date(dia4Janeiro);

  primeiraSegunda.setUTCDate(
    dia4Janeiro.getUTCDate()
    - diaSemana
    + 1
  );

  const segundaDaSemana =
    new Date(primeiraSegunda);

  segundaDaSemana.setUTCDate(
    primeiraSegunda.getUTCDate()
    + (semana - 1) * 7
  );

  return segundaDaSemana;
}


function shiftWeek(weekStr, delta) {

  if (!weekStr) {
    return isoWeekString(new Date());
  }

  const monday =
    mondayFromWeekString(weekStr);

  monday.setUTCDate(
    monday.getUTCDate()
    + delta * 7
  );

  return isoWeekString(monday);
}

  // ---------- storage helpers ----------
  async function carregarSemanaAPI(semana) {
  try {
    const resposta = await fetch(
      `/api/planejamentos/${semana}`
    );

    if (!resposta.ok) {
      throw new Error('Erro ao carregar a semana');
    }

    const dados = await resposta.json();

    const semanaData = emptyWeekData();

    (dados.planejamentos || []).forEach(item => {

      if (!semanaData[item.dia]) {
        semanaData[item.dia] = [];
      }

      semanaData[item.dia].push({
        id: item.bloco_id,
        start: item.hora_inicio
          ? item.hora_inicio.slice(0, 5)
          : '',
        end: item.hora_fim
          ? item.hora_fim.slice(0, 5)
          : '',
        local: item.local || '',
        atividades: item.atividades || [],
        texto: item.observacao || ''
      });
    });

    return semanaData;

  } catch (error) {

    console.error(
      'Erro ao carregar planejamento:',
      error
    );

    return emptyWeekData();
  }
}

async function excluirBlocoAPI(semana, dia, blocoId) {
  try {
    els.saveDot.classList.add('saving');
    els.saveText.textContent = 'excluindo...';

    const resposta = await fetch(
      `/api/planejamentos/${encodeURIComponent(semana)}/${encodeURIComponent(dia)}/${encodeURIComponent(blocoId)}`,
      {
        method: 'DELETE'
      }
    );

    // Se o registro ainda não existia no banco,
    // podemos considerar a interface sincronizada.
    if (!resposta.ok && resposta.status !== 404) {
      throw new Error('Erro ao excluir bloco');
    }

    storageOK = true;

  } catch (error) {
    console.error('Erro ao excluir planejamento:', error);
    storageOK = false;

  } finally {
    els.saveDot.classList.remove('saving');
    els.saveText.textContent =
      storageOK ? 'salvo' : 'erro ao excluir';
  }
}

async function salvarBlocoAPI(
  semana,
  dia,
  bloco
) {

  try {

    els.saveDot.classList.add('saving');
    els.saveText.textContent = 'salvando...';

    const resposta = await fetch(
      '/api/planejamentos',
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json'
        },

        body: JSON.stringify({
          semana: semana,
          dia: dia,
          bloco_id: bloco.id,
          hora_inicio: bloco.start || null,
          hora_fim: bloco.end || null,
          local: bloco.local || null,
          observacao: bloco.texto || null,
          atividades: bloco.atividades || []
        })
      }
    );

    if (!resposta.ok) {
      throw new Error('Erro ao salvar bloco');
    }

    storageOK = true;

  } catch (error) {

    console.error(
      'Erro ao salvar planejamento:',
      error
    );

    storageOK = false;

  } finally {

    els.saveDot.classList.remove('saving');

    els.saveText.textContent =
      storageOK
        ? 'salvo'
        : 'erro ao salvar';
  }
}

  function emptyWeekData(){
    const obj = {};
    DAYS.forEach(d => obj[d.key] = []);
    return obj;
  }

  function uid(){ return Math.random().toString(36).slice(2,9); }

  function badgeColorFor(text){
    const t = (text||'').trim().toUpperCase();
    if(!t) return '#B9B2A3';
    let hash = 0;
    for(let i=0;i<t.length;i++) hash = (hash*31 + t.charCodeAt(i)) >>> 0;
    return BADGE_PALETTE[hash % BADGE_PALETTE.length];
  }

  // ---------- render ----------
  async function loadOptions() {

  // Começa com as opções já existentes no sistema
  optionsCache = {
    locais: [...DEFAULT_LOCAIS],
    atividades: [...DEFAULT_PROPOSTAS]
  };

  try {

    // Acrescenta também as opções gravadas no PostgreSQL
    const resposta = await fetch('/api/opcoes');

    if (!resposta.ok) {
      throw new Error('Erro ao carregar opções');
    }

    const dados = await resposta.json();

    (dados.opcoes || []).forEach(opcao => {

      const tipo = String(opcao.tipo || '')
        .trim()
        .toLowerCase();

      const valor = String(opcao.valor || '')
        .trim();

      if (!valor) return;

      if (tipo === 'local') {

        const existe = optionsCache.locais.some(
          item =>
            item.toLowerCase() ===
            valor.toLowerCase()
        );

        if (!existe) {
          optionsCache.locais.push(valor);
        }
      }

      if (tipo === 'atividade') {

        const existe = optionsCache.atividades.some(
          item =>
            item.toLowerCase() ===
            valor.toLowerCase()
        );

        if (!existe) {
          optionsCache.atividades.push(valor);
        }
      }

    });

    // Ordena as sugestões
    optionsCache.locais.sort((a, b) =>
      a.localeCompare(b, 'pt-BR')
    );

    optionsCache.atividades.sort((a, b) =>
      a.localeCompare(b, 'pt-BR')
    );

  } catch (error) {

    console.error(
      'Erro ao carregar opções:',
      error
    );

  }

  renderDatalists();
}

  function renderDatalists(){
    let dlLocais = document.getElementById('dl-locais');
    if(!dlLocais){ dlLocais = document.createElement('datalist'); dlLocais.id='dl-locais'; document.body.appendChild(dlLocais); }
    dlLocais.innerHTML = optionsCache.locais.map(o=>`<option value="${escapeHtml(o)}">`).join('');

    let dlAtiv = document.getElementById('dl-atividades');
    if(!dlAtiv){ dlAtiv = document.createElement('datalist'); dlAtiv.id='dl-atividades'; document.body.appendChild(dlAtiv); }
    dlAtiv.innerHTML = optionsCache.atividades.map(o=>`<option value="${escapeHtml(o)}">`).join('');
  }

  async function addOption(type, value) {

  value = value.trim();

  if (!value) return;

  let novaOpcao = false;

  if (
    type === 'local' &&
    !optionsCache.locais.some(
      o =>
        o.toLowerCase() ===
        value.toLowerCase()
    )
  ) {
    optionsCache.locais.push(value);
    novaOpcao = true;
  }

  if (
    type === 'atividade' &&
    !optionsCache.atividades.some(
      o =>
        o.toLowerCase() ===
        value.toLowerCase()
    )
  ) {
    optionsCache.atividades.push(value);
    novaOpcao = true;
  }

  renderDatalists();

  if (!novaOpcao) return;

  try {

    const resposta = await fetch(
      '/api/opcoes',
      {
        method: 'POST',

        headers: {
          'Content-Type': 'application/json'
        },

        body: JSON.stringify({
          tipo: type,
          valor: value
        })
      }
    );

    if (!resposta.ok) {
      throw new Error(
        'Erro ao salvar opção'
      );
    }

  } catch (error) {

    console.error(
      'Erro ao salvar nova opção:',
      error
    );
  }
}

  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  async function loadWeek(weekStr) {

  els.saveText.textContent = 'carregando...';

  currentWeekData =
    await carregarSemanaAPI(weekStr);

  renderWeek(weekStr);

  els.saveText.textContent = 'salvo';
}

  async function saveCurrentWeek(weekStr) {

  for (const day of DAYS) {

    const blocos =
      currentWeekData[day.key] || [];

    for (const bloco of blocos) {

      await salvarBlocoAPI(
        weekStr,
        day.key,
        bloco
      );
    }
  }
}

  function renderWeek(weekStr){
    const monday = mondayFromWeekString(weekStr);
    const fridayDate = new Date(monday); fridayDate.setUTCDate(monday.getUTCDate()+4);
    els.rangeLabel.textContent = `${fmtDate(monday)} a ${fmtDate(fridayDate)}`;

    els.daysContainer.innerHTML = '';
    DAYS.forEach((day, idx) => {
      const dateForDay = new Date(monday); dateForDay.setUTCDate(monday.getUTCDate()+idx);
      const col = document.createElement('div');
      col.className = 'day-col';
      col.innerHTML = `
        <div class="day-head" style="background:${day.color}">
          <span class="abbr">${day.abbr}</span>
          <span class="full">${day.full}</span>
          <span class="date">${fmtDate(dateForDay)}</span>
        </div>
        <div class="blocks" data-day="${day.key}"></div>
        <button class="add-block-btn" data-day="${day.key}">+ Adicionar horário</button>
      `;
      els.daysContainer.appendChild(col);
      renderBlocks(day.key);
    });
  }

  function renderBlocks(dayKey){
    const container = els.daysContainer.querySelector(`.blocks[data-day="${dayKey}"]`);
    const blocks = currentWeekData[dayKey] || [];
    container.innerHTML = '';
    if(blocks.length === 0){
      container.innerHTML = `<div class="empty-hint">Nenhum horário ainda</div>`;
      return;
    }
    blocks.forEach(block => container.appendChild(renderBlock(dayKey, block)));
  }

  function renderBlock(dayKey, block){
    const el = document.createElement('div');
    el.className = 'block';
    el.dataset.id = block.id;

    el.innerHTML = `
      <div class="block-time">
        <input type="time" class="t-start" value="${block.start||''}">
        <span class="as">às</span>
        <input type="time" class="t-end" value="${block.end||''}">
        <button class="remove-block" title="Remover horário">✕</button>
      </div>
      <div class="local-wrap">
        <input class="local-badge-input" list="dl-locais" placeholder="LOCAL / DESTAQUE (ex: PARQUE)" value="${escapeHtml(block.local||'')}">
      </div>
      <div class="atividades-wrap">
  <div class="tags"></div>

  <div class="atividade-add-wrap">
    <input
      class="atividade-input"
      list="dl-atividades"
      placeholder="Digite ou selecione uma proposta"
    >
    <button
      type="button"
      class="atividade-add-btn"
      title="Adicionar proposta"
    >+ Adicionar</button>
  </div>

  <div class="hint-add">
    Selecione/digite uma proposta e clique em Adicionar
  </div>
</div>
      <textarea class="block-text" placeholder="Escreva aqui (tema, observações)...">${escapeHtml(block.texto||'')}</textarea>
    `;

    // ---------- horários ----------

    const inputInicio = el.querySelector('.t-start');
    const inputFim = el.querySelector('.t-end');

    // Mantém o objeto sincronizado enquanto o usuário altera
    inputInicio.addEventListener('input', () => {
      block.start = inputInicio.value;
    });

    inputFim.addEventListener('input', () => {
      block.end = inputFim.value;
    });

    // Salva no PostgreSQL quando terminar a alteração
    inputInicio.addEventListener('change', () => {
  block.start = inputInicio.value;
  persist();
    });

    inputFim.addEventListener('change', () => {
      block.end = inputFim.value;
    persist();
    });

    // ---------- local ----------

    const applyLocalStyle = (input) => {
      const c = badgeColorFor(input.value);
      input.style.background = c + '22';
      input.style.color = c;
      input.style.borderColor = c + '55';
    };

    const localInput = el.querySelector('.local-badge-input');
    applyLocalStyle(localInput);
    localInput.addEventListener('input', () => applyLocalStyle(localInput));
    localInput.addEventListener('change', async () => {
      block.local = localInput.value;
      await addOption('local', localInput.value);
      persist(dayKey);
    });

    el.querySelector('.remove-block').addEventListener('click', async () => {

  const confirmou = confirm(
    'Deseja realmente excluir este horário?'
  );

  if (!confirmou) return;

  await excluirBlocoAPI(
    els.weekPicker.value,
    dayKey,
    block.id
  );

  if (!storageOK) {
    alert('Não foi possível excluir o horário.');
    return;
  }

  currentWeekData[dayKey] =
    currentWeekData[dayKey].filter(
      b => b.id !== block.id
    );

  renderBlocks(dayKey);
});

    el.querySelector('.block-text').addEventListener('change', e => { block.texto = e.target.value; persist(dayKey); });

    const tagsWrap = el.querySelector('.tags');
    function renderTags(){
      tagsWrap.innerHTML = '';
      (block.atividades||[]).forEach((tag, i) => {
        const t = document.createElement('span');
        t.className = 'tag';
        t.innerHTML = `${escapeHtml(tag)} <button type="button">✕</button>`;
        t.querySelector('button').addEventListener('click', () => {
          block.atividades.splice(i,1);
          renderTags();
          persist(dayKey);
        });
        tagsWrap.appendChild(t);
      });
    }
    renderTags();

    const ativInput = el.querySelector('.atividade-input');
    const ativAddBtn = el.querySelector('.atividade-add-btn');

async function adicionarProposta() {

  const val = ativInput.value.trim();

  if (!val) return;

  if (!block.atividades) {
    block.atividades = [];
  }

  const existe = block.atividades.some(
    a =>
      a.toLowerCase() ===
      val.toLowerCase()
  );

  if (!existe) {
    block.atividades.push(val);
  }

  // Salva a proposta também nas opções
  await addOption(
    'atividade',
    val
  );

  // Limpa o campo
  ativInput.value = '';

  // Atualiza as etiquetas
  renderTags();

  // Salva no PostgreSQL
  persist();
}

// Botão + Adicionar
ativAddBtn.addEventListener('click', async () => {
  await adicionarProposta();
});


// COMPUTADOR:
// Enter ou vírgula adiciona a proposta
ativInput.addEventListener('keydown', async (e) => {

  if (e.key === 'Enter' || e.key === ',') {

    e.preventDefault();

    await adicionarProposta();
  }

});

    return el;
  }

  //alterar horário, local, atividade ou observação, o persist() 
  // continuará sendo chamado pelos listeners existentes.

  let persistTimer = null;
  function persist(){
    clearTimeout(persistTimer);
    persistTimer = setTimeout(() => saveCurrentWeek(els.weekPicker.value), 350);
  }

  // ---------- add block ----------
  els.daysContainer.addEventListener('click', (e) => {
    if(e.target.classList.contains('add-block-btn')){
      const dayKey = e.target.dataset.day;
      if(!currentWeekData[dayKey]) currentWeekData[dayKey] = [];
      currentWeekData[dayKey].push({ id: uid(), start:'', end:'', local:'', atividades:[], texto:'' });
      renderBlocks(dayKey);
      persist();
    }
  });

  // ---------- navegação entre semanas ----------

async function irParaSemana(weekStr) {

  if (!weekStr) return;

  els.weekPicker.value = weekStr;

  localStorage.setItem(
    'semanaSelecionada',
    weekStr
  );

  await loadWeek(weekStr);
}


// Seleção manual da semana
els.weekPicker.addEventListener('change', async () => {

  await irParaSemana(
    els.weekPicker.value
  );

});


// Semana anterior
els.prevWeek.addEventListener('click', async () => {

  const semanaAtual = els.weekPicker.value;

  if (!semanaAtual) return;

  const semanaAnterior =
    shiftWeek(semanaAtual, -1);

  await irParaSemana(
    semanaAnterior
  );

});


// Próxima semana
els.nextWeek.addEventListener('click', async () => {

  const semanaAtual = els.weekPicker.value;

  console.log(
    'Semana atual:',
    semanaAtual
  );

  if (!semanaAtual) {
    console.error(
      'Nenhuma semana selecionada.'
    );
    return;
  }

  const proximaSemana =
    shiftWeek(semanaAtual, 1);

  console.log(
    'Próxima semana:',
    proximaSemana
  );

  await irParaSemana(
    proximaSemana
  );

});


// ---------- copiar semana anterior ----------

els.duplicateBtn.addEventListener('click', async () => {

  const semanaDestino = els.weekPicker.value;

  const semanaOrigem = shiftWeek(
    semanaDestino,
    -1
  );

  try {

    els.saveDot.classList.add('saving');
    els.saveText.textContent = 'verificando...';

    // 1. Verifica se a semana destino já possui dados
    const dadosDestino = await carregarSemanaAPI(
      semanaDestino
    );

    const destinoTemDados = DAYS.some(
      d =>
        (dadosDestino[d.key] || []).length > 0
    );

    if (destinoTemDados) {

      const confirmouSobrescrita = confirm(
        'A semana atual já possui planejamentos.\n\n' +
        'Ao continuar, os horários que tiverem o mesmo identificador poderão ser atualizados.\n\n' +
        'Deseja realmente copiar a semana anterior?'
      );

      if (!confirmouSobrescrita) {
        els.saveText.textContent = 'salvo';
        return;
      }
    }

    // 2. Confirma a cópia
    const confirmou = confirm(
      `Copiar os planejamentos de ${semanaOrigem} para ${semanaDestino}?`
    );

    if (!confirmou) {
      els.saveText.textContent = 'salvo';
      return;
    }

    els.saveText.textContent = 'copiando...';

    // 3. Chama a API
    const resposta = await fetch(
      '/api/planejamentos/copiar-semana',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          semana_origem: semanaOrigem,
          semana_destino: semanaDestino
        })
      }
    );

    const dados = await resposta.json();

    if (!resposta.ok) {
      alert(
        dados.mensagem ||
        'Não foi possível copiar a semana anterior.'
      );
      return;
    }

    // 4. Recarrega a semana diretamente do banco
    await loadWeek(
      semanaDestino
    );

    alert(
      `Semana copiada com sucesso!\n` +
      `${dados.totalCopiados} horário(s) copiado(s).`
    );

  } catch (error) {

    console.error(
      'Erro ao copiar semana:',
      error
    );

    alert(
      'Erro ao copiar a semana anterior.'
    );

  } finally {

    els.saveDot.classList.remove('saving');
    els.saveText.textContent = 'salvo';
  }
});


// ---------- imprimir ----------

els.printBtn.addEventListener(
  'click',
  () => window.print()
);


// ---------- inicialização ----------

(async function init() {

  const semanaAtual =
    isoWeekString(
      new Date()
    );

  const semanaSalva =
    localStorage.getItem(
      'semanaSelecionada'
    );

  const semanaInicial =
    semanaSalva || semanaAtual;

  els.weekPicker.value =
    semanaInicial;

  await loadOptions();

  await loadWeek(
    semanaInicial
  );

})();

})();

