"use strict";

const DB_NAME = "macroDayTracker";
const DB_VERSION = 1;
const DAYS_STORE = "days";
const SETTINGS_STORE = "settings";
const SETTINGS_KEY = "app-settings";
const BACKUP_KEY = "macroDayTrackerRecoveryBackupV1";
const MEALS = ["breakfast", "lunch", "dinner"];

let database;
let currentDate = getLocalDateString(new Date());
let currentDay = createEmptyDay(currentDate);
let settings = createDefaultSettings();
let toastTimer;

const el = {};

window.addEventListener("DOMContentLoaded", initializeApp);

async function initializeApp() {
  cacheElements();
  bindEvents();

  try {
    database = await openDatabase();
    await recoverFromMirrorIfNeeded();
    settings = (await getRecord(SETTINGS_STORE, SETTINGS_KEY)) || createDefaultSettings();
    currentDay = (await getRecord(DAYS_STORE, currentDate)) || createEmptyDay(currentDate);
    await requestPersistentStorage();
    updateStorageProtectionMessage();
    renderAll();
    setSaveStatus("saved", "Saved automatically");
  } catch (error) {
    console.error(error);
    const backup = readRecoveryBackup();
    if (backup) {
      settings = backup.settings || createDefaultSettings();
      currentDay = backup.days?.[currentDate] || createEmptyDay(currentDate);
      renderAll();
      setSaveStatus("error", "Database unavailable — recovery copy loaded");
    } else {
      renderAll();
      setSaveStatus("error", "Storage could not be opened");
    }
  }

  if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("sw.js").catch(error => console.warn("Service worker registration failed", error));
  }
}

function cacheElements() {
  const ids = [
    "dataButton", "previousDay", "nextDay", "dateButton", "datePicker", "datePrimary", "dateSecondary",
    "saveDot", "saveStatus", "goalsButton", "dailyCalories", "dailyProtein", "dailyCarbs", "dailyFat",
    "caloriesGoalText", "proteinGoalText", "carbsGoalText", "fatGoalText", "caloriesProgress", "proteinProgress",
    "carbsProgress", "fatProgress", "breakfastTotals", "lunchTotals", "dinnerTotals", "breakfastList", "lunchList",
    "dinnerList", "historyButton", "foodDialog", "foodForm", "foodDialogTitle", "entryId",
    "mealSelect", "foodName", "proteinInput", "carbsInput", "fatInput", "calculatedCalories", "overrideCaloriesCheck",
    "calorieOverrideWrap", "caloriesInput", "recentFoodsArea", "recentFoods", "goalsDialog", "goalsForm", "goalCalories",
    "goalProtein", "goalCarbs", "goalFat", "historyDialog", "historyList", "dataDialog", "storageProtectionTitle",
    "storageProtectionText", "exportJsonButton", "exportCsvButton", "importFileInput", "deleteAllButton", "toast"
  ];
  ids.forEach(id => { el[id] = document.getElementById(id); });
}

function bindEvents() {
  el.previousDay.addEventListener("click", () => shiftDate(-1));
  el.nextDay.addEventListener("click", () => shiftDate(1));
  el.dateButton.addEventListener("click", () => {
    el.datePicker.value = currentDate;
    if (typeof el.datePicker.showPicker === "function") el.datePicker.showPicker();
    else el.datePicker.click();
  });
  el.datePicker.addEventListener("change", event => changeDate(event.target.value));

  document.querySelectorAll("[data-add-meal]").forEach(button => {
    button.addEventListener("click", () => openFoodDialog(button.dataset.addMeal));
  });
  document.querySelectorAll("[data-close-dialog]").forEach(button => {
    button.addEventListener("click", () => document.getElementById(button.dataset.closeDialog).close());
  });

  el.foodForm.addEventListener("submit", saveFoodEntry);
  [el.proteinInput, el.carbsInput, el.fatInput].forEach(input => input.addEventListener("input", updateCalculatedCalories));
  el.overrideCaloriesCheck.addEventListener("change", () => {
    el.calorieOverrideWrap.hidden = !el.overrideCaloriesCheck.checked;
    if (el.overrideCaloriesCheck.checked && !el.caloriesInput.value) el.caloriesInput.value = calculateCaloriesFromInputs();
  });

  el.goalsButton.addEventListener("click", openGoalsDialog);
  el.goalsForm.addEventListener("submit", saveGoals);
  el.historyButton.addEventListener("click", openHistoryDialog);
  el.dataButton.addEventListener("click", () => {
    updateStorageProtectionMessage();
    el.dataDialog.showModal();
  });
  el.exportJsonButton.addEventListener("click", exportJsonBackup);
  el.exportCsvButton.addEventListener("click", exportCsvHistory);
  el.importFileInput.addEventListener("change", importJsonBackup);
  el.deleteAllButton.addEventListener("click", deleteAllData);

  [el.foodDialog, el.goalsDialog, el.historyDialog, el.dataDialog].forEach(dialog => {
    dialog.addEventListener("click", event => {
      if (event.target === dialog) dialog.close();
    });
  });
}

function createEmptyDay(date) {
  return {
    date,
    meals: { breakfast: [], lunch: [], dinner: [] },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function createDefaultSettings() {
  return {
    id: SETTINGS_KEY,
    goals: { calories: null, protein: null, carbs: null, fat: null },
    recentFoods: [],
    updatedAt: new Date().toISOString()
  };
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DAYS_STORE)) db.createObjectStore(DAYS_STORE, { keyPath: "date" });
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) db.createObjectStore(SETTINGS_STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Unable to open database"));
  });
}

function getRecord(storeName, key) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAllRecords(storeName) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readonly");
    const request = transaction.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function putRecord(storeName, value) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).put(value);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

function clearStore(storeName) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(storeName, "readwrite");
    transaction.objectStore(storeName).clear();
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function saveCurrentDay() {
  currentDay.updatedAt = new Date().toISOString();
  setSaveStatus("saving", "Saving…");
  try {
    await putRecord(DAYS_STORE, structuredClone(currentDay));
  } catch (error) {
    console.error(error);
    setSaveStatus("error", "Save failed — download a backup");
    showToast("Could not save this change.");
    return;
  }

  try {
    await updateRecoveryMirror(currentDay);
    setSaveStatus("saved", "Saved automatically · recovery copy updated");
  } catch (error) {
    console.warn("Primary save succeeded, but the recovery copy could not be updated", error);
    setSaveStatus("saved", "Saved automatically · backup download recommended");
  }
}

async function saveSettings() {
  settings.updatedAt = new Date().toISOString();
  await putRecord(SETTINGS_STORE, structuredClone(settings));
  try {
    await updateRecoveryMirror(null, settings);
  } catch (error) {
    console.warn("Settings saved, but the recovery copy could not be updated", error);
  }
}

async function updateRecoveryMirror(day = null, newSettings = null) {
  const backup = readRecoveryBackup() || { version: 1, exportedAt: null, days: {}, settings: createDefaultSettings() };
  if (day) backup.days[day.date] = structuredClone(day);
  if (newSettings) backup.settings = structuredClone(newSettings);
  backup.exportedAt = new Date().toISOString();
  localStorage.setItem(BACKUP_KEY, JSON.stringify(backup));
}

function readRecoveryBackup() {
  try {
    const raw = localStorage.getItem(BACKUP_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return validateBackupShape(parsed) ? parsed : null;
  } catch (error) {
    console.warn("Recovery backup could not be read", error);
    return null;
  }
}

async function recoverFromMirrorIfNeeded() {
  const existingDays = await getAllRecords(DAYS_STORE);
  const existingSettings = await getRecord(SETTINGS_STORE, SETTINGS_KEY);
  if (existingDays.length || existingSettings) return;

  const backup = readRecoveryBackup();
  if (!backup) return;
  for (const day of Object.values(backup.days || {})) await putRecord(DAYS_STORE, normalizeDay(day));
  if (backup.settings) await putRecord(SETTINGS_STORE, normalizeSettings(backup.settings));
}

async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return false;
  try { return await navigator.storage.persist(); }
  catch { return false; }
}

async function updateStorageProtectionMessage() {
  if (!el.storageProtectionTitle) return;
  let persisted = false;
  try { persisted = Boolean(await navigator.storage?.persisted?.()); } catch { persisted = false; }
  if (persisted) {
    el.storageProtectionTitle.textContent = "Persistent browser storage is active";
    el.storageProtectionText.textContent = "Entries use IndexedDB plus a separate recovery copy. The browser has agreed not to automatically evict this data.";
  } else {
    el.storageProtectionTitle.textContent = "Automatic dual-copy saving is active";
    el.storageProtectionText.textContent = "Entries use IndexedDB plus a separate recovery copy. Download a backup to protect against cleared browser data or a replaced device.";
  }
}

function renderAll() {
  renderDate();
  renderDailySummary();
  MEALS.forEach(renderMeal);
}

function renderDate() {
  const selected = parseLocalDate(currentDate);
  const today = getLocalDateString(new Date());
  const yesterday = shiftDateString(today, -1);
  const tomorrow = shiftDateString(today, 1);
  let primary = selected.toLocaleDateString(undefined, { weekday: "long" });
  if (currentDate === today) primary = "Today";
  else if (currentDate === yesterday) primary = "Yesterday";
  else if (currentDate === tomorrow) primary = "Tomorrow";
  el.datePrimary.textContent = primary;
  el.dateSecondary.textContent = selected.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  el.datePicker.value = currentDate;
}

function renderDailySummary() {
  const totals = calculateDayTotals(currentDay);
  el.dailyCalories.textContent = formatNumber(totals.calories, 0);
  el.dailyProtein.textContent = formatNumber(totals.protein, 1);
  el.dailyCarbs.textContent = formatNumber(totals.carbs, 1);
  el.dailyFat.textContent = formatNumber(totals.fat, 1);

  renderGoal("calories", totals.calories, "caloriesGoalText", "caloriesProgress", "cal");
  renderGoal("protein", totals.protein, "proteinGoalText", "proteinProgress", "g");
  renderGoal("carbs", totals.carbs, "carbsGoalText", "carbsProgress", "g");
  renderGoal("fat", totals.fat, "fatGoalText", "fatProgress", "g");
}

function renderGoal(key, current, textId, progressId, unit) {
  const goal = numberOrNull(settings.goals?.[key]);
  if (!goal) {
    el[textId].textContent = "No goal set";
    el[progressId].style.width = "0%";
    return;
  }
  const remaining = Math.max(0, goal - current);
  const over = Math.max(0, current - goal);
  el[textId].textContent = over > 0
    ? `${formatNumber(over, key === "calories" ? 0 : 1)} ${unit} over`
    : `${formatNumber(remaining, key === "calories" ? 0 : 1)} ${unit} left`;
  el[progressId].style.width = `${Math.min(100, (current / goal) * 100)}%`;
}

function renderMeal(meal) {
  const entries = currentDay.meals[meal] || [];
  const totals = calculateEntriesTotals(entries);
  el[`${meal}Totals`].innerHTML = [
    mealTotalMarkup("Cal", formatNumber(totals.calories, 0)),
    mealTotalMarkup("Protein", `${formatNumber(totals.protein, 1)}g`),
    mealTotalMarkup("Carbs", `${formatNumber(totals.carbs, 1)}g`),
    mealTotalMarkup("Fat", `${formatNumber(totals.fat, 1)}g`)
  ].join("");

  if (!entries.length) {
    el[`${meal}List`].innerHTML = `<div class="empty-meal">Nothing logged yet</div>`;
    return;
  }

  el[`${meal}List`].innerHTML = entries.map(entry => `
    <div class="food-row">
      <div class="food-row-main">
        <p class="food-name">${escapeHtml(entry.name)}</p>
        <p class="food-macros">${formatNumber(entry.calories, 0)} cal · P ${formatNumber(entry.protein, 1)}g · C ${formatNumber(entry.carbs, 1)}g · F ${formatNumber(entry.fat, 1)}g</p>
      </div>
      <div class="food-actions">
        <button class="food-action" type="button" data-edit-id="${entry.id}" data-edit-meal="${meal}" aria-label="Edit ${escapeHtml(entry.name)}">Edit</button>
        <button class="food-action delete" type="button" data-delete-id="${entry.id}" data-delete-meal="${meal}" aria-label="Delete ${escapeHtml(entry.name)}">×</button>
      </div>
    </div>
  `).join("");

  el[`${meal}List`].querySelectorAll("[data-edit-id]").forEach(button => {
    button.addEventListener("click", () => editFoodEntry(button.dataset.editMeal, button.dataset.editId));
  });
  el[`${meal}List`].querySelectorAll("[data-delete-id]").forEach(button => {
    button.addEventListener("click", () => deleteFoodEntry(button.dataset.deleteMeal, button.dataset.deleteId));
  });
}

function mealTotalMarkup(label, value) {
  return `<div class="meal-total"><span>${label}</span><strong>${value}</strong></div>`;
}

function openFoodDialog(meal = "breakfast", entry = null) {
  el.foodForm.reset();
  el.entryId.value = entry?.id || "";
  el.foodDialogTitle.textContent = entry ? "Edit food" : "Add food";
  el.mealSelect.value = meal;
  el.foodName.value = entry?.name || "";
  el.proteinInput.value = entry ? entry.protein : "";
  el.carbsInput.value = entry ? entry.carbs : "";
  el.fatInput.value = entry ? entry.fat : "";

  if (entry) {
    const calculated = calculateCalories(entry.protein, entry.carbs, entry.fat);
    const differs = Math.abs(calculated - Number(entry.calories)) >= 1;
    el.overrideCaloriesCheck.checked = differs;
    el.calorieOverrideWrap.hidden = !differs;
    el.caloriesInput.value = differs ? entry.calories : "";
  } else {
    el.overrideCaloriesCheck.checked = false;
    el.calorieOverrideWrap.hidden = true;
    el.caloriesInput.value = "";
  }

  renderRecentFoods();
  updateCalculatedCalories();
  el.foodDialog.showModal();
  setTimeout(() => el.foodName.focus(), 50);
}

function renderRecentFoods() {
  const recent = settings.recentFoods || [];
  el.recentFoodsArea.hidden = recent.length === 0;
  el.recentFoods.innerHTML = recent.map((food, index) => `<button class="recent-chip" type="button" data-recent-index="${index}">${escapeHtml(food.name)}</button>`).join("");
  el.recentFoods.querySelectorAll("[data-recent-index]").forEach(button => {
    button.addEventListener("click", () => fillRecentFood(recent[Number(button.dataset.recentIndex)]));
  });
}

function fillRecentFood(food) {
  el.foodName.value = food.name;
  el.proteinInput.value = food.protein;
  el.carbsInput.value = food.carbs;
  el.fatInput.value = food.fat;
  const calculated = calculateCalories(food.protein, food.carbs, food.fat);
  const differs = Math.abs(calculated - Number(food.calories)) >= 1;
  el.overrideCaloriesCheck.checked = differs;
  el.calorieOverrideWrap.hidden = !differs;
  el.caloriesInput.value = differs ? food.calories : "";
  updateCalculatedCalories();
}

async function saveFoodEntry(event) {
  event.preventDefault();
  const name = el.foodName.value.trim();
  const protein = nonNegativeNumber(el.proteinInput.value);
  const carbs = nonNegativeNumber(el.carbsInput.value);
  const fat = nonNegativeNumber(el.fatInput.value);
  const calories = el.overrideCaloriesCheck.checked
    ? nonNegativeNumber(el.caloriesInput.value)
    : calculateCalories(protein, carbs, fat);

  if (!name) return showToast("Enter a food name.");
  if ([protein, carbs, fat, calories].some(value => value === null)) return showToast("Macro values must be zero or greater.");

  const destinationMeal = el.mealSelect.value;
  const existingId = el.entryId.value;
  let existingMeal = null;
  if (existingId) existingMeal = MEALS.find(meal => currentDay.meals[meal].some(item => item.id === existingId));

  const entry = {
    id: existingId || makeId(),
    name,
    calories: round(calories, 1),
    protein: round(protein, 1),
    carbs: round(carbs, 1),
    fat: round(fat, 1),
    createdAt: existingId
      ? currentDay.meals[existingMeal].find(item => item.id === existingId)?.createdAt || new Date().toISOString()
      : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  if (existingId && existingMeal) {
    currentDay.meals[existingMeal] = currentDay.meals[existingMeal].filter(item => item.id !== existingId);
  }
  currentDay.meals[destinationMeal].push(entry);
  rememberRecentFood(entry);
  await saveSettings();
  await saveCurrentDay();
  el.foodDialog.close();
  renderAll();
  showToast(existingId ? "Food updated." : "Food added.");
}

function editFoodEntry(meal, id) {
  const entry = currentDay.meals[meal].find(item => item.id === id);
  if (entry) openFoodDialog(meal, entry);
}

async function deleteFoodEntry(meal, id) {
  const entry = currentDay.meals[meal].find(item => item.id === id);
  if (!entry) return;
  if (!confirm(`Delete “${entry.name}”?`)) return;
  currentDay.meals[meal] = currentDay.meals[meal].filter(item => item.id !== id);
  await saveCurrentDay();
  renderAll();
  showToast("Food deleted.");
}

function rememberRecentFood(entry) {
  const signature = foodSignature(entry);
  const filtered = (settings.recentFoods || []).filter(food => foodSignature(food) !== signature);
  settings.recentFoods = [{
    name: entry.name,
    calories: entry.calories,
    protein: entry.protein,
    carbs: entry.carbs,
    fat: entry.fat
  }, ...filtered].slice(0, 12);
}

function foodSignature(food) {
  return `${String(food.name).trim().toLowerCase()}|${food.calories}|${food.protein}|${food.carbs}|${food.fat}`;
}

function openGoalsDialog() {
  el.goalCalories.value = settings.goals.calories ?? "";
  el.goalProtein.value = settings.goals.protein ?? "";
  el.goalCarbs.value = settings.goals.carbs ?? "";
  el.goalFat.value = settings.goals.fat ?? "";
  el.goalsDialog.showModal();
}

async function saveGoals(event) {
  event.preventDefault();
  settings.goals = {
    calories: positiveNumberOrNull(el.goalCalories.value),
    protein: positiveNumberOrNull(el.goalProtein.value),
    carbs: positiveNumberOrNull(el.goalCarbs.value),
    fat: positiveNumberOrNull(el.goalFat.value)
  };
  await saveSettings();
  renderDailySummary();
  el.goalsDialog.close();
  showToast("Goals saved.");
}

async function openHistoryDialog() {
  let days = [];
  try { days = await getAllRecords(DAYS_STORE); }
  catch { days = Object.values(readRecoveryBackup()?.days || {}); }
  days.sort((a, b) => b.date.localeCompare(a.date));
  const nonEmptyDays = days.filter(day => countEntries(day) > 0);

  if (!nonEmptyDays.length) {
    el.historyList.innerHTML = `<div class="history-empty">Your saved days will appear here.</div>`;
  } else {
    el.historyList.innerHTML = nonEmptyDays.map(day => {
      const totals = calculateDayTotals(day);
      return `<button class="history-row" type="button" data-history-date="${day.date}">
        <span>
          <span class="history-date">${formatLongDate(day.date)}</span>
          <span class="history-meta">P ${formatNumber(totals.protein,1)}g · C ${formatNumber(totals.carbs,1)}g · F ${formatNumber(totals.fat,1)}g · ${countEntries(day)} item${countEntries(day) === 1 ? "" : "s"}</span>
        </span>
        <span class="history-calories">${formatNumber(totals.calories,0)} cal</span>
      </button>`;
    }).join("");
    el.historyList.querySelectorAll("[data-history-date]").forEach(button => {
      button.addEventListener("click", async () => {
        el.historyDialog.close();
        await changeDate(button.dataset.historyDate);
      });
    });
  }
  el.historyDialog.showModal();
}

async function changeDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
  currentDate = date;
  try { currentDay = (await getRecord(DAYS_STORE, currentDate)) || createEmptyDay(currentDate); }
  catch { currentDay = readRecoveryBackup()?.days?.[currentDate] || createEmptyDay(currentDate); }
  renderAll();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function shiftDate(days) { return changeDate(shiftDateString(currentDate, days)); }

async function exportJsonBackup() {
  const days = await safelyGetAllDays();
  const backup = {
    app: "Macro Day Tracker",
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: structuredClone(settings),
    days: Object.fromEntries(days.map(day => [day.date, day]))
  };
  downloadFile(`macro-day-backup-${getLocalDateString(new Date())}.json`, JSON.stringify(backup, null, 2), "application/json");
  showToast("Backup downloaded.");
}

async function exportCsvHistory() {
  const days = (await safelyGetAllDays()).sort((a, b) => a.date.localeCompare(b.date));
  const rows = [["Date", "Meal", "Food", "Calories", "Protein (g)", "Carbs (g)", "Fat (g)"]];
  days.forEach(day => MEALS.forEach(meal => (day.meals[meal] || []).forEach(food => {
    rows.push([day.date, capitalize(meal), food.name, food.calories, food.protein, food.carbs, food.fat]);
  })));
  const csv = rows.map(row => row.map(csvCell).join(",")).join("\r\n");
  downloadFile(`macro-day-history-${getLocalDateString(new Date())}.csv`, csv, "text/csv;charset=utf-8");
  showToast("Spreadsheet downloaded.");
}

async function importJsonBackup(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!validateBackupShape(parsed)) throw new Error("This is not a valid Macro Day backup.");
    if (!confirm("Restore this backup? Existing days with the same date will be replaced.")) return;

    for (const day of Object.values(parsed.days || {})) await putRecord(DAYS_STORE, normalizeDay(day));
    settings = normalizeSettings(parsed.settings || createDefaultSettings());
    await putRecord(SETTINGS_STORE, settings);

    const mergedDays = await getAllRecords(DAYS_STORE);
    const mergedBackup = {
      version: 1,
      exportedAt: new Date().toISOString(),
      settings,
      days: Object.fromEntries(mergedDays.map(day => [day.date, day]))
    };
    localStorage.setItem(BACKUP_KEY, JSON.stringify(mergedBackup));
    currentDay = (await getRecord(DAYS_STORE, currentDate)) || createEmptyDay(currentDate);
    renderAll();
    el.dataDialog.close();
    showToast("Backup restored.");
  } catch (error) {
    console.error(error);
    showToast(error.message || "Backup could not be restored.");
  }
}

async function deleteAllData() {
  if (!confirm("Delete every saved day, recent food, and goal? This cannot be undone unless you have downloaded a backup.")) return;
  if (!confirm("Are you absolutely sure you want to erase all macro history?")) return;
  await clearStore(DAYS_STORE);
  await clearStore(SETTINGS_STORE);
  localStorage.removeItem(BACKUP_KEY);
  settings = createDefaultSettings();
  currentDay = createEmptyDay(currentDate);
  renderAll();
  el.dataDialog.close();
  showToast("All data deleted.");
}

async function safelyGetAllDays() {
  try { return await getAllRecords(DAYS_STORE); }
  catch { return Object.values(readRecoveryBackup()?.days || {}); }
}

function validateBackupShape(value) {
  if (!value || typeof value !== "object" || typeof value.days !== "object") return false;
  return Object.entries(value.days).every(([date, day]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && day && typeof day === "object");
}

function normalizeDay(day) {
  const normalized = createEmptyDay(day.date);
  MEALS.forEach(meal => {
    normalized.meals[meal] = Array.isArray(day.meals?.[meal])
      ? day.meals[meal].map(item => ({
          id: String(item.id || makeId()),
          name: String(item.name || "Food").slice(0, 80),
          calories: Math.max(0, Number(item.calories) || 0),
          protein: Math.max(0, Number(item.protein) || 0),
          carbs: Math.max(0, Number(item.carbs) || 0),
          fat: Math.max(0, Number(item.fat) || 0),
          createdAt: item.createdAt || new Date().toISOString(),
          updatedAt: item.updatedAt || new Date().toISOString()
        }))
      : [];
  });
  normalized.createdAt = day.createdAt || new Date().toISOString();
  normalized.updatedAt = day.updatedAt || new Date().toISOString();
  return normalized;
}

function normalizeSettings(value) {
  const defaults = createDefaultSettings();
  return {
    id: SETTINGS_KEY,
    goals: {
      calories: positiveNumberOrNull(value.goals?.calories),
      protein: positiveNumberOrNull(value.goals?.protein),
      carbs: positiveNumberOrNull(value.goals?.carbs),
      fat: positiveNumberOrNull(value.goals?.fat)
    },
    recentFoods: Array.isArray(value.recentFoods)
      ? value.recentFoods.slice(0, 12).map(food => ({
          name: String(food.name || "Food").slice(0, 80),
          calories: Math.max(0, Number(food.calories) || 0),
          protein: Math.max(0, Number(food.protein) || 0),
          carbs: Math.max(0, Number(food.carbs) || 0),
          fat: Math.max(0, Number(food.fat) || 0)
        }))
      : defaults.recentFoods,
    updatedAt: value.updatedAt || new Date().toISOString()
  };
}

function calculateDayTotals(day) {
  return MEALS.reduce((totals, meal) => addTotals(totals, calculateEntriesTotals(day.meals?.[meal] || [])), emptyTotals());
}

function calculateEntriesTotals(entries) {
  return entries.reduce((totals, entry) => ({
    calories: totals.calories + (Number(entry.calories) || 0),
    protein: totals.protein + (Number(entry.protein) || 0),
    carbs: totals.carbs + (Number(entry.carbs) || 0),
    fat: totals.fat + (Number(entry.fat) || 0)
  }), emptyTotals());
}

function emptyTotals() { return { calories: 0, protein: 0, carbs: 0, fat: 0 }; }
function addTotals(a, b) { return { calories: a.calories + b.calories, protein: a.protein + b.protein, carbs: a.carbs + b.carbs, fat: a.fat + b.fat }; }
function countEntries(day) { return MEALS.reduce((count, meal) => count + (day.meals?.[meal]?.length || 0), 0); }
function calculateCalories(protein, carbs, fat) { return round((Number(protein) || 0) * 4 + (Number(carbs) || 0) * 4 + (Number(fat) || 0) * 9, 0); }
function calculateCaloriesFromInputs() { return calculateCalories(el.proteinInput.value, el.carbsInput.value, el.fatInput.value); }
function updateCalculatedCalories() { el.calculatedCalories.textContent = formatNumber(calculateCaloriesFromInputs(), 0); }


function setSaveStatus(status, text) {
  el.saveDot.className = `save-dot ${status === "saved" ? "saved" : status === "error" ? "error" : ""}`;
  el.saveStatus.textContent = text;
}

function showToast(message) {
  clearTimeout(toastTimer);
  el.toast.textContent = message;
  el.toast.classList.add("show");
  toastTimer = setTimeout(() => el.toast.classList.remove("show"), 2400);
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

function csvCell(value) { return `"${String(value ?? "").replaceAll('"', '""')}"`; }
function capitalize(value) { return value.charAt(0).toUpperCase() + value.slice(1); }
function round(value, digits = 1) { const factor = 10 ** digits; return Math.round((Number(value) + Number.EPSILON) * factor) / factor; }
function formatNumber(value, digits = 1) { return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: digits }); }
function numberOrNull(value) { const number = Number(value); return Number.isFinite(number) && number > 0 ? number : null; }
function positiveNumberOrNull(value) { if (value === null || value === undefined || value === "") return null; const number = Number(value); return Number.isFinite(number) && number > 0 ? number : null; }
function nonNegativeNumber(value) { const number = Number(value); return Number.isFinite(number) && number >= 0 ? number : null; }
function makeId() { return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]); }

function getLocalDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
function parseLocalDate(dateString) { const [year, month, day] = dateString.split("-").map(Number); return new Date(year, month - 1, day, 12); }
function shiftDateString(dateString, amount) { const date = parseLocalDate(dateString); date.setDate(date.getDate() + amount); return getLocalDateString(date); }
function formatLongDate(dateString) { return parseLocalDate(dateString).toLocaleDateString(undefined, { weekday: "short", month: "long", day: "numeric", year: "numeric" }); }
