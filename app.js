const state = {
  catalog: [],
  byName: new Map(),
  inventory: [],
  selectedSex: '公',
  nextId: 1,
  lastPlan: null,
  targetName: null,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escapeHtml = (value) => String(value).replace(/[&<>'"]/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));

function parseCsv(text) {
  const lines = text.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const headers = lines.shift().split(',').map(x => x.trim());
  const index = Object.fromEntries(headers.map((name, i) => [name, i]));
  return lines.filter(Boolean).map(line => {
    const cols = line.split(',').map(x => x.trim());
    return {
      no: cols[index['图鉴编号']],
      name: cols[index['一阶精灵']],
      groups: cols[index['蛋组']].split('/').map(x => x.trim()).filter(Boolean),
      type: cols[index['异色类型']],
    };
  });
}

async function loadCatalog() {
  const response = await fetch('pets.csv', {cache: 'no-store'});
  if (!response.ok) throw new Error('异色精灵数据载入失败');
  state.catalog = parseCsv(await response.text());
  state.byName = new Map(state.catalog.map(pet => [pet.name, pet]));
  $('#catalogCount').textContent = `${state.catalog.length} 只异色精灵`;
  $('#petOptions').innerHTML = state.catalog.map(pet => `<option value="${escapeHtml(pet.name)}">${escapeHtml(pet.groups.join(' / '))}</option>`).join('');
}

function sharedGroups(a, b) {
  return a.groups.filter(group => b.groups.includes(group));
}

function countBySpecies(items) {
  return [...items.reduce((map, item) => {
    const current = map.get(item.pet.name) || {pet: item.pet, count: 0};
    current.count++;
    map.set(item.pet.name, current);
    return map;
  }, new Map()).values()];
}

function addInventoryItem(name, sex, render = true) {
  const pet = state.byName.get(name.trim());
  if (!pet || !['公', '母'].includes(sex)) return false;
  state.inventory.push({id: state.nextId++, sex, pet});
  if (render) renderInventory();
  return true;
}

function renderInventory() {
  if (state.lastPlan) {
    state.lastPlan = null;
    $('#planResult').classList.add('hidden');
    $('#emptyResult').classList.remove('hidden');
  }
  $('#inventoryCount').textContent = `${state.inventory.length} 只`;
  $('#generate').disabled = state.inventory.length === 0;
  $('#clearAll').style.visibility = state.inventory.length ? 'visible' : 'hidden';
  if (!state.inventory.length) {
    $('#inventory').innerHTML = '<div class="empty-small">还没有录入精灵</div>';
    if (state.targetName) renderTargetAnalysis(state.targetName);
    return;
  }
  $('#inventory').innerHTML = state.inventory.map(item => `
    <div class="pet-row">
      <span class="sex-dot ${item.sex === '公' ? 'm' : 'f'}">${item.sex === '公' ? '♂' : '♀'}</span>
      <div><div class="pet-name">${escapeHtml(item.pet.name)}</div><div class="pet-groups">${escapeHtml(item.pet.groups.join(' / '))}</div></div>
      <button class="remove" type="button" data-remove="${item.id}" aria-label="移除${escapeHtml(item.pet.name)}">×</button>
    </div>`).join('');
  $$('[data-remove]').forEach(button => button.addEventListener('click', () => {
    state.inventory = state.inventory.filter(item => item.id !== Number(button.dataset.remove));
    renderInventory();
  }));
  if (state.targetName) renderTargetAnalysis(state.targetName);
}

function createPlan(entries) {
  const males = entries.filter(item => item.sex === '公');
  const females = entries.filter(item => item.sex === '母');
  const maleSpecies = countBySpecies(males);
  const femaleSpecies = countBySpecies(females);
  const allPairs = maleSpecies.flatMap(male => femaleSpecies.map(female => {
    const shared = sharedGroups(male.pet, female.pet);
    return shared.length ? {male, female, shared, individualPairs: male.count * female.count} : null;
  }).filter(Boolean)).sort((a, b) => Number(a.male.pet.no) - Number(b.male.pet.no) || Number(a.female.pet.no) - Number(b.female.pet.no));
  const unassigned = [...females];
  const rooms = [];

  while (unassigned.length) {
    const compatibleCount = female => males.filter(male => sharedGroups(male.pet, female.pet).length).length;
    const choices = males.map(male => ({
      male,
      compatible: unassigned.filter(female => sharedGroups(male.pet, female.pet).length),
    })).filter(choice => choice.compatible.length)
      .sort((a, b) => b.compatible.length - a.compatible.length || Number(a.male.pet.no) - Number(b.male.pet.no) || a.male.id - b.male.id);
    if (!choices.length) break;
    const chosen = choices[0];
    const assigned = chosen.compatible
      .sort((a, b) => compatibleCount(a) - compatibleCount(b) || Number(a.pet.no) - Number(b.pet.no) || a.id - b.id)
      .slice(0, 2);
    rooms.push({males: [chosen.male], females: assigned});
    const ids = new Set(assigned.map(item => item.id));
    for (let i = unassigned.length - 1; i >= 0; i--) if (ids.has(unassigned[i].id)) unassigned.splice(i, 1);
  }

  const blockers = unassigned.map(female => ({female, needed: female.pet.groups}));
  const covered = females.length - blockers.length;
  return {males, females, rooms, blockers, covered, allPairs};
}

function groupDuplicateFemales(females, males) {
  const grouped = new Map();
  females.forEach(item => {
    const key = item.pet.name;
    const shared = [...new Set(males.flatMap(male => sharedGroups(male.pet, item.pet)))];
    if (!grouped.has(key)) grouped.set(key, {pet: item.pet, count: 0, shared});
    grouped.get(key).count++;
  });
  return [...grouped.values()];
}

function buildTargetAnalysis(name) {
  const target = state.byName.get(String(name || '').trim());
  if (!target) throw new Error('请选择有效的目标异色精灵');
  const targetFemales = state.inventory.filter(item => item.sex === '母' && item.pet.name === target.name);
  const ownedMales = countBySpecies(state.inventory.filter(item => item.sex === '公'))
    .map(group => ({...group, shared: sharedGroups(group.pet, target)}))
    .filter(group => group.shared.length)
    .sort((a, b) => b.shared.length - a.shared.length || Number(a.pet.no) - Number(b.pet.no));
  const ownedMap = new Map(ownedMales.map(group => [group.pet.name, group.count]));
  const candidateMales = state.catalog
    .map(pet => ({pet, shared: sharedGroups(pet, target), owned: ownedMap.get(pet.name) || 0}))
    .filter(candidate => candidate.shared.length)
    .sort((a, b) => Number(b.owned > 0) - Number(a.owned > 0) || b.shared.length - a.shared.length || Number(a.pet.no) - Number(b.pet.no));
  return {target, targetFemaleCount: targetFemales.length, ownedMales, candidateMales};
}

function renderTargetAnalysis(name, shouldScroll = false) {
  const analysis = buildTargetAnalysis(name);
  state.targetName = analysis.target.name;
  if (!state.lastPlan) $('#emptyResult').classList.add('hidden');
  const container = $('#targetResult');
  container.classList.remove('hidden');
  const hasFemale = analysis.targetFemaleCount > 0;
  const hasMale = analysis.ownedMales.length > 0;
  const status = hasFemale && hasMale ? '可直接执行' : hasMale ? '补目标母宠即可' : '需要补充亲代';
  const directHtml = hasMale ? `<div class="target-pairs">${analysis.ownedMales.map(male => `<div class="target-pair"><span class="pair-male">♂ ${escapeHtml(male.pet.name)}${male.count > 1 ? ` × ${male.count}` : ''}</span><span class="pair-sign">×</span><span class="pair-female">♀ ${escapeHtml(analysis.target.name)}${analysis.targetFemaleCount > 1 ? ` × ${analysis.targetFemaleCount}` : ''}</span><small>${escapeHtml(male.shared.join(' / '))}</small></div>`).join('')}</div>` : '<div class="notice">你的当前异色库存里没有兼容公宠，可从下方候选中准备任意一种。</div>';
  const femaleGuide = hasFemale
    ? `你已有 ${analysis.targetFemaleCount} 只异色母 ${escapeHtml(analysis.target.name)}，子代会跟随母方。`
    : `需要准备一只母 ${escapeHtml(analysis.target.name)} 作为母方；普通母宠也能低概率产出异色，异色母宠会提高概率。`;
  const candidatesHtml = analysis.candidateMales.map(candidate => `<span class="candidate-chip ${candidate.owned ? 'owned' : ''}">♂ ${escapeHtml(candidate.pet.name)} · ${escapeHtml(candidate.shared.join(' / '))}${candidate.owned ? ` · 已有 ${candidate.owned}` : ''}</span>`).join('');
  container.innerHTML = `<div class="target-card"><div class="target-head"><div><span class="eyebrow">目标异色</span><h2>${escapeHtml(analysis.target.name)}</h2><p>${femaleGuide}</p></div><span class="badge ${hasFemale && hasMale ? 'ready' : 'pending'}">${status}</span></div><div class="target-block"><h3>用现有异色公宠搭配</h3>${directHtml}</div><div class="target-block"><h3>全部可选公宠 · ${analysis.candidateMales.length} 种</h3><p class="section-note">以下候选来自当前异色目录；任意一种公宠与母 ${escapeHtml(analysis.target.name)} 共享蛋组即可。</p><div class="candidate-list">${candidatesHtml}</div></div><div class="notice">目标种族必须放在母方，因为子代种类跟随母方。普通亲代也有低概率产出异色，亲代含异色时概率更高。</div></div>`;
  if (shouldScroll) requestAnimationFrame(() => container.scrollIntoView({behavior: 'smooth', block: 'start'}));
  return {
    target: analysis.target.name,
    target_groups: analysis.target.groups,
    owned_target_females: analysis.targetFemaleCount,
    owned_compatible_males: analysis.ownedMales.map(male => ({name: male.pet.name, count: male.count, shared_groups: male.shared})),
    candidate_males: analysis.candidateMales.map(candidate => ({name: candidate.pet.name, shared_groups: candidate.shared, owned_count: candidate.owned})),
  };
}

function renderPlan(plan) {
  state.lastPlan = plan;
  $('#emptyResult').classList.add('hidden');
  const result = $('#planResult');
  result.classList.remove('hidden');
  const noPairReason = !plan.males.length ? '当前没有异色公宠，因此没有可执行配对；公宠不是必填项，之后补录再生成即可。' : !plan.females.length ? '当前没有异色母宠，因此没有可产蛋的配对。' : '现有公母精灵之间没有共享蛋组。';
  const roomsHtml = plan.rooms.length ? `<div class="rooms">${plan.rooms.map((room, index) => {
    const grouped = groupDuplicateFemales(room.females, room.males);
    return `<article class="room"><div class="room-head"><span class="room-title">批次 ${index + 1}</span><span class="occupancy">${room.females.length + room.males.length} / 10</span></div><div class="female-list">${room.males.map(male => `<div class="stud"><span class="stud-mark">♂</span><div><strong>${escapeHtml(male.pet.name)}</strong><small>${escapeHtml(male.pet.groups.join(' / '))}</small></div><span class="badge ready" style="margin-left:auto">现有公宠</span></div>`).join('')}${grouped.map(group => `<div class="female"><span>♀ ${escapeHtml(group.pet.name)}${group.count > 1 ? ` × ${group.count}` : ''}</span><span>${escapeHtml(group.shared.join(' / '))}</span></div>`).join('')}</div></article>`;
  }).join('')}</div>` : `<div class="notice">${escapeHtml(noPairReason)}</div>`;
  const blockedHtml = plan.blockers.length ? `<div class="blocked">${plan.blockers.map(item => `<div class="blocked-row"><strong>♀ ${escapeHtml(item.female.pet.name)}</strong><span>现有公宠没有与它共享 ${escapeHtml(item.needed.join(' / '))} 蛋组，本次先不安排。</span></div>`).join('')}</div>` : '<div class="notice">当前所有可产蛋的母宠都已安排。</div>';
  const allPairsHtml = plan.allPairs.length ? `<div class="pair-grid">${plan.allPairs.map(pair => `<article class="pair-card"><div class="pair-pets"><span class="pair-male">♂ ${escapeHtml(pair.male.pet.name)}${pair.male.count > 1 ? ` × ${pair.male.count}` : ''}</span><span class="pair-sign">×</span><span class="pair-female">♀ ${escapeHtml(pair.female.pet.name)}${pair.female.count > 1 ? ` × ${pair.female.count}` : ''}</span></div><div class="pair-meta"><span>${escapeHtml(pair.shared.join(' / '))}</span><span>${pair.individualPairs} 个个体配对</span></div></article>`).join('')}</div>` : `<div class="notice">${escapeHtml(noPairReason)}</div>`;
  const executable = plan.rooms.length > 0;
  const planStatus = !executable ? '暂无可执行配对' : plan.blockers.length ? '部分可执行' : '可完整覆盖';
  result.innerHTML = `
    <div class="plan-header"><div><h2>生蛋规划</h2><p>只使用你实际拥有的精灵；推荐批次优先安排 1 公 2 母，不足时安排 1 公 1 母。</p></div><span class="badge ${executable && !plan.blockers.length ? 'ready' : 'pending'}">${planStatus}</span></div>
    <div class="metrics"><div class="metric"><strong>${plan.covered}/${plan.females.length}</strong><span>可安排母宠</span></div><div class="metric"><strong>${plan.males.length}</strong><span>现有异色公宠</span></div><div class="metric"><strong>${plan.rooms.length}</strong><span>1v2 推荐批次</span></div><div class="metric"><strong>${plan.allPairs.length}</strong><span>可行种类组合</span></div></div>
    <section class="plan-section"><h3>当前可执行批次</h3><p class="section-note">每批最多 1 只公宠配 2 只兼容母宠；同一只公宠可在不同批次重复使用。</p>${roomsHtml}</section>
    <section class="plan-section"><h3>全部可行配对 · ${plan.allPairs.length} 种</h3><p class="section-note">列出当前库存中所有共享蛋组的公母组合；同名个体合并显示数量，不遗漏组合。</p>${allPairsHtml}</section>
    <section class="plan-section"><h3>本次未安排</h3>${blockedHtml}</section>
    <section class="plan-section"><div class="notice">蛋的种族跟随母方。亲代异色只会提高异色蛋概率，并不保证每枚蛋都是异色。</div></section>`;
}

function generateAndRender() {
  const plan = createPlan(state.inventory);
  renderPlan(plan);
  return {
    inventory_count: state.inventory.length,
    existing_males: plan.males.length,
    females: plan.females.length,
    covered_females: plan.covered,
    rooms: plan.rooms.map(room => ({males: room.males.map(item => item.pet.name), females: room.females.map(item => item.pet.name)})),
    all_pairs: plan.allPairs.map(pair => ({male: pair.male.pet.name, male_count: pair.male.count, female: pair.female.pet.name, female_count: pair.female.count, shared_groups: pair.shared, individual_pairs: pair.individualPairs})),
    blocked: plan.blockers.map(item => item.female.pet.name),
  };
}

function replaceInventory(items) {
  const next = [];
  const errors = [];
  items.forEach((item, index) => {
    const pet = state.byName.get(String(item.name || '').trim());
    const sex = String(item.sex || '').trim().replace('雄', '公').replace('雌', '母');
    const count = Math.max(1, Math.min(99, Number(item.count || 1)));
    if (!pet || !['公', '母'].includes(sex)) {
      errors.push(index + 1);
      return;
    }
    for (let i = 0; i < count; i++) next.push({id: state.nextId++, sex, pet});
  });
  if (errors.length) throw new Error(`第 ${errors.join('、')} 项的名称或性别无效`);
  state.inventory = next;
  renderInventory();
}

function normalizeSex(value) {
  return String(value || '').trim().replace('雄', '公').replace('雌', '母');
}

function splitImportLine(line) {
  if (line.includes('\t')) return line.split('\t').map(value => value.trim());
  if (/[,，]/.test(line)) return line.split(/[,，]/).map(value => value.trim());
  const match = line.match(/^(.+?)\s+(公|母|雄|雌)(?:\s+(\d+))?$/);
  return match ? [match[1].trim(), match[2], match[3] || ''] : [line.trim()];
}

function parseInventoryText(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  const items = [];
  const invalidLines = [];
  let columns = null;

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return;
    const cells = splitImportLine(line);
    const normalizedHeaders = cells.map(cell => cell.replace(/\s/g, ''));
    const nameIndex = normalizedHeaders.findIndex(cell => ['名称', '精灵名称', '一阶精灵'].includes(cell));
    const sexIndex = normalizedHeaders.findIndex(cell => ['性别', '公母'].includes(cell));
    if (!columns && nameIndex >= 0 && sexIndex >= 0) {
      columns = {name: nameIndex, sex: sexIndex, count: normalizedHeaders.findIndex(cell => ['数量', '个数'].includes(cell))};
      return;
    }

    const name = (columns ? cells[columns.name] : cells[0])?.trim();
    const sex = normalizeSex(columns ? cells[columns.sex] : cells[1]);
    const countText = columns?.count >= 0 ? cells[columns.count] : cells[2];
    const count = countText === undefined || countText === '' ? 1 : Number(countText);
    if (!state.byName.has(name) || !['公', '母'].includes(sex) || !Number.isInteger(count) || count < 1 || count > 99) {
      invalidLines.push(index + 1);
      return;
    }
    items.push({name, sex, count});
  });

  return {items, invalidLines};
}

function importInventoryText(text, mode = 'replace') {
  const parsed = parseInventoryText(text);
  if (!parsed.items.length) throw new Error(parsed.invalidLines.length ? `没有可导入的有效记录；请检查第 ${parsed.invalidLines.join('、')} 行` : '文件中没有可导入的记录');
  const nextItems = mode === 'append'
    ? [...state.inventory.map(item => ({name: item.pet.name, sex: item.sex, count: 1})), ...parsed.items]
    : parsed.items;
  replaceInventory(nextItems);
  return {ok: true, mode, imported_count: parsed.items.reduce((sum, item) => sum + item.count, 0), inventory_count: state.inventory.length, invalid_lines: parsed.invalidLines};
}

function showImportStatus(selector, message, isError = false) {
  const status = $(selector);
  status.classList.remove('hidden');
  status.classList.toggle('error', isError);
  status.textContent = message;
}

function setupEvents() {
  $$('.sex-btn').forEach(button => button.addEventListener('click', () => {
    state.selectedSex = button.dataset.sex;
    $$('.sex-btn').forEach(item => item.classList.toggle('active', item === button));
  }));
  const addSelected = () => {
    const input = $('#petName');
    if (!addInventoryItem(input.value, state.selectedSex)) {
      input.setCustomValidity('请从异色精灵列表中选择有效名称');
      input.reportValidity();
      return;
    }
    input.setCustomValidity('');
    input.value = '';
    input.focus();
  };
  $('#addPet').addEventListener('click', addSelected);
  $('#petName').addEventListener('keydown', event => { if (event.key === 'Enter') addSelected(); });
  $('#clearAll').addEventListener('click', () => {
    state.inventory = [];
    state.lastPlan = null;
    renderInventory();
    $('#planResult').classList.add('hidden');
    $('#emptyResult').classList.toggle('hidden', Boolean(state.targetName));
  });
  $('#bulkAdd').addEventListener('click', () => {
    try {
      const result = importInventoryText($('#bulkInput').value, 'append');
      const suffix = result.invalid_lines.length ? `；第 ${result.invalid_lines.join('、')} 行未识别。` : '。';
      showImportStatus('#importStatus', `已加入 ${result.imported_count} 只${suffix}`);
    } catch (error) {
      showImportStatus('#importStatus', error.message, true);
    }
  });
  $('#inventoryFile').addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    $('#fileName').textContent = file.name;
    if (file.size > 1024 * 1024) {
      showImportStatus('#fileImportStatus', '文件超过 1 MB，请拆分后再导入。', true);
      event.target.value = '';
      return;
    }
    try {
      const result = importInventoryText(await file.text(), $('#fileImportMode').value);
      const action = result.mode === 'append' ? '追加' : '导入';
      const suffix = result.invalid_lines.length ? `；第 ${result.invalid_lines.join('、')} 行未识别。` : '。';
      showImportStatus('#fileImportStatus', `已${action} ${result.imported_count} 只，当前共 ${result.inventory_count} 只${suffix}`);
    } catch (error) {
      showImportStatus('#fileImportStatus', error.message, true);
    }
    event.target.value = '';
  });
  $('#downloadTemplate').addEventListener('click', () => {
    const blob = new Blob(['name,sex,count\n'], {type: 'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '异色精灵导入模板.csv';
    link.click();
    URL.revokeObjectURL(url);
  });
  const analyzeSelectedTarget = () => {
    const input = $('#targetPetName');
    try {
      input.setCustomValidity('');
      renderTargetAnalysis(input.value, true);
    } catch (error) {
      input.setCustomValidity(error.message);
      input.reportValidity();
    }
  };
  $('#analyzeTarget').addEventListener('click', analyzeSelectedTarget);
  $('#targetPetName').addEventListener('keydown', event => { if (event.key === 'Enter') analyzeSelectedTarget(); });
  $('#generate').addEventListener('click', generateAndRender);
}

function registerWebMcp() {
  const context = document.modelContext;
  if (!context?.registerTool) return;
  const controller = new AbortController();
  context.registerTool({
    name: 'set_breeding_inventory',
    title: '设置异色精灵库存',
    description: '用精灵名称、性别和数量替换页面中的异色精灵库存。',
    inputSchema: {type:'object',properties:{items:{type:'array',items:{type:'object',properties:{name:{type:'string'},sex:{type:'string',enum:['公','母']},count:{type:'integer',minimum:1,maximum:99}},required:['name','sex'],additionalProperties:false}}},required:['items'],additionalProperties:false},
    annotations: {readOnlyHint:false,untrustedContentHint:false},
    execute: ({items}) => { replaceInventory(items); return {ok:true,count:state.inventory.length}; },
  }, {signal: controller.signal});
  context.registerTool({
    name: 'import_breeding_inventory_text',
    title: '从文本导入异色精灵库存',
    description: '解析 TXT、CSV 或 TSV 文本中的精灵名称、性别和可选数量，并替换或追加到页面库存。',
    inputSchema: {type:'object',properties:{text:{type:'string'},mode:{type:'string',enum:['replace','append']}},required:['text'],additionalProperties:false},
    annotations: {readOnlyHint:false,untrustedContentHint:true},
    execute: ({text, mode = 'replace'}) => importInventoryText(text, mode),
  }, {signal: controller.signal});
  context.registerTool({
    name: 'generate_breeding_plan',
    title: '生成生蛋规划',
    description: '根据页面当前库存生成每批不超过十只的推荐规划，并列出所有可行公母配对。',
    inputSchema: {type:'object',properties:{},additionalProperties:false},
    annotations: {readOnlyHint:false,untrustedContentHint:false},
    execute: () => generateAndRender(),
  }, {signal: controller.signal});
  context.registerTool({
    name: 'analyze_target_shiny',
    title: '分析目标异色精灵搭配',
    description: '分析指定目标异色精灵需要的母方，并列出库存中可直接使用的公宠及全部候选公宠。',
    inputSchema: {type:'object',properties:{name:{type:'string'}},required:['name'],additionalProperties:false},
    annotations: {readOnlyHint:false,untrustedContentHint:false},
    execute: ({name}) => renderTargetAnalysis(name),
  }, {signal: controller.signal});
}

loadCatalog().then(() => {
  setupEvents();
  renderInventory();
  registerWebMcp();
}).catch(error => {
  $('#catalogCount').textContent = '数据载入失败';
  $('#emptyResult').innerHTML = `<div><h2>无法载入异色精灵数据</h2><p>${escapeHtml(error.message)}</p></div>`;
});
