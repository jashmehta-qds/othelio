"use client";

import { useEffect, useRef, useState } from "react";

export default function LiveIndexCounter({
  initialValue = 104.28,
  value: controlledValue,
}: {
  initialValue?: number;
  value?: number;
}) {
  const [value, setValue] = useState(controlledValue ?? initialValue);
  const [flashClass, setFlashClass] = useState<string>("");
  const prevRef = useRef(controlledValue ?? initialValue);

  useEffect(() => {
    if (controlledValue !== undefined) {
      setValue(controlledValue);
      prevRef.current = controlledValue;
    }
  }, [controlledValue]);

  useEffect(() => {
    const interval = setInterval(() => {
      // Fluctuate price by +-$1.20 to +-$5.40
      const isUp = Math.random() > 0.48;
      const delta = isUp
        ? Math.random() * 3.8 + 1.2
        : -(Math.random() * 3.8 + 1.2);

      const prev = prevRef.current;
      const next = Math.max(95.50, Math.min(118.50, prev + delta));
      const finalVal = Number(next.toFixed(2));
      const isIncrease = finalVal >= prev;

      prevRef.current = finalVal;
      setValue(finalVal);

      // Reset and trigger instant keyframe flash animation class on price update
      setFlashClass("");
      requestAnimationFrame(() => {
        setFlashClass(isIncrease ? "flash-stock-green" : "flash-stock-red");
      });
    }, 5500); // Slower tick interval: updates every 5.5 seconds

    return () => clearInterval(interval);
  }, []);

  return (
    <strong className={`font-mono font-bold px-1 rounded-sm ${flashClass}`}>
      {value.toFixed(2)}
    </strong>
  );
}
