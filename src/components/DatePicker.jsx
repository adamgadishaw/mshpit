import { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { colors, mono } from "../theme";

// Column picker for Year / Month / Day - one canonical format, no ambiguity.
const YEARS = [2026, 2027, 2028, 2029];
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const daysIn = (y, m) => new Date(y, m, 0).getDate();
const pad = (n) => String(n).padStart(2, "0");
const partsFor = (value, fallbackYear, today = new Date()) => {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const year = match ? Number(match[1]) : fallbackYear;
  const month = match ? Number(match[2]) : today.getMonth() + 1;
  const day = match ? Number(match[3]) : today.getDate();
  const validMonth = Math.max(1, Math.min(12, month));
  return { year, month: validMonth, day: Math.max(1, Math.min(daysIn(year, validMonth), day)) };
};

function Column({ values, selected, onSelect, render }) {
  return (
    <ScrollView style={styles.col} contentContainerStyle={styles.colContent} showsVerticalScrollIndicator={false}>
      {values.map((v) => {
        const on = v === selected;
        return (
          <Pressable key={v} style={[styles.cell, on && styles.cellOn]} onPress={() => onSelect(v)}>
            <Text style={[styles.cellTxt, on && styles.cellTxtOn]}>{render ? render(v) : pad(v)}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export default function DatePicker({ value, onChange, years = YEARS, defaultYear }) {
  const today = new Date();
  const fallbackYear = defaultYear || years[0];
  const initial = partsFor(value, fallbackYear, today);
  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  const [day, setDay] = useState(initial.day);

  const dim = daysIn(year, month);
  const days = Array.from({ length: dim }, (_, i) => i + 1);
  const clampedDay = Math.min(day, dim);

  // Stay in sync when a saved draft is resumed while this picker is open, but
  // do not emit on mount. The old mount effect replaced an edited concert's
  // historical date with today before the person tapped a single control.
  useEffect(() => {
    const next = partsFor(value, fallbackYear, today);
    setYear(next.year);
    setMonth(next.month);
    setDay(next.day);
    // `today` is a render-local fallback; canonical `value` drives normal use.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, fallbackYear]);

  const select = (nextYear, nextMonth, nextDay) => {
    const safeDay = Math.max(1, Math.min(daysIn(nextYear, nextMonth), nextDay));
    setYear(nextYear);
    setMonth(nextMonth);
    setDay(safeDay);
    // Canonical storage stays separate from the formatted preview.
    onChange?.(`${nextYear}-${pad(nextMonth)}-${pad(safeDay)}`);
  };

  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  return (
    <View>
      <View style={styles.heads}>
        <Text style={styles.head}>YEAR</Text>
        <Text style={styles.head}>MONTH</Text>
        <Text style={styles.head}>DAY</Text>
      </View>
      <View style={styles.cols}>
        <Column values={years} selected={year} onSelect={(next) => select(next, month, clampedDay)} render={(v) => String(v)} />
        <Column values={MONTHS} selected={month} onSelect={(next) => select(year, next, clampedDay)} render={(v) => `${pad(v)} ${MONTH_NAMES[v - 1]}`} />
        <Column values={days} selected={clampedDay} onSelect={(next) => select(year, month, next)} />
      </View>
      <Text style={styles.preview}>{`${year} · ${pad(month)} · ${pad(clampedDay)}`}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  heads: { flexDirection: "row" },
  head: { flex: 1, color: colors.textFaint, fontSize: 10, letterSpacing: 1, fontWeight: "700", textAlign: "center", marginBottom: 6 },
  cols: { flexDirection: "row", gap: 8, height: 150 },
  col: { flex: 1, backgroundColor: colors.surface, borderRadius: 10, borderWidth: 1, borderColor: colors.lineSoft },
  colContent: { paddingVertical: 6 },
  cell: { paddingVertical: 9, alignItems: "center", marginHorizontal: 6, borderRadius: 8 },
  cellOn: { backgroundColor: colors.bgElev, borderWidth: 1, borderColor: colors.amber },
  cellTxt: { color: colors.textDim, fontSize: 14, fontFamily: mono },
  cellTxtOn: { color: colors.amber, fontWeight: "800" },
  preview: { color: colors.gold, fontFamily: mono, fontSize: 15, textAlign: "center", marginTop: 10, letterSpacing: 1 },
});
