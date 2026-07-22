import { useState, useEffect } from "react";
import { View, Text, StyleSheet, ScrollView, Pressable } from "react-native";
import { colors, mono } from "../theme";

// Column picker for Year / Month / Day - one canonical format, no ambiguity.
const YEARS = [2026, 2027, 2028, 2029];
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const daysIn = (y, m) => new Date(y, m, 0).getDate();
const pad = (n) => String(n).padStart(2, "0");

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

export default function DatePicker({ onChange, years = YEARS, defaultYear }) {
  const today = new Date();
  const [year, setYear] = useState(defaultYear || years[0]);
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [day, setDay] = useState(today.getDate());

  const dim = daysIn(year, month);
  const days = Array.from({ length: dim }, (_, i) => i + 1);
  const clampedDay = Math.min(day, dim);

  // Emits the canonical stored form (ISO); the preview below shows the display
  // form. Keeping those two apart is what stops a separator change from forking
  // a performance. See src/domain/dates.mjs.
  useEffect(() => {
    onChange?.(`${year}-${pad(month)}-${pad(clampedDay)}`);
  }, [year, month, clampedDay]);

  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  return (
    <View>
      <View style={styles.heads}>
        <Text style={styles.head}>YEAR</Text>
        <Text style={styles.head}>MONTH</Text>
        <Text style={styles.head}>DAY</Text>
      </View>
      <View style={styles.cols}>
        <Column values={years} selected={year} onSelect={setYear} render={(v) => String(v)} />
        <Column values={MONTHS} selected={month} onSelect={setMonth} render={(v) => `${pad(v)} ${MONTH_NAMES[v - 1]}`} />
        <Column values={days} selected={clampedDay} onSelect={setDay} />
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
