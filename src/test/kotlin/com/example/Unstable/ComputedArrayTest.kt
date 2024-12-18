package com.example.Unstable

import com.example.Signal
import com.example.Computed
import com.example.Effect
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ComputedArrayTest {

    @Test
    fun testGetUpdatedItemValue() {
        val src = Signal(listOf(1))
        val arr = ComputedArray(src) { item, _ -> { item.get() + 1 } }
        assertEquals(2, arr[0])
    }

    @Test
    fun testWatchItemValueChange() {
        val src = Signal(listOf(1))
        val arr = ComputedArray(src) { item, _ -> { item.get() + 1 } }
        var triggered = false
        Effect {
            triggered = true
            arr[0]
        }
        assertTrue(triggered)
        triggered = false
        src.set(listOf(2))
        assertTrue(triggered)
    }

    @Test
    fun testNotTriggerIfItemValueDidNotChange() {
        val src = Signal(listOf(1))
        val arr = ComputedArray(src) { item, _ -> { item.get() + 1 } }
        var triggered = false
        Effect {
            triggered = true
            arr[0]
        }
        assertTrue(triggered)
        triggered = false
        src.set(listOf(1))
        assertTrue(!triggered)
    }

    @Test
    fun testNotTriggerFirstItemComputedIfSourceItemDidNotChange() {
        val src = Signal(listOf(1))
        val arr = ComputedArray(src) { item, i ->
            {
                if (i == 0) {
                    assertTrue(true)
                }
                item.get() + 1
            }
        }
        Effect { arr[0] }
        src.set(listOf(1, 2))
        src.set(listOf(2, 2, 3))
    }

    @Test
    fun testWatchLengthChange() {
        val src = Signal(listOf(1))
        val arr = ComputedArray(src) { item, _ -> { item.get() + 1 } }
        var triggered = false
        Effect {
            triggered = true
            arr.size
        }
        assertTrue(triggered)
        triggered = false
        src.set(listOf(2))
        assertTrue(!triggered)
        src.set(listOf(2, 3))
        assertTrue(triggered)
    }

    @Test
    fun testWatchItemRemove() {
        val src = Signal(listOf(1, 2))
        val arr = ComputedArray(src) { item, _ -> { item.get() + 1 } }
        var triggered = false
        Effect {
            triggered = true
            arr[0]
        }
        assertTrue(triggered)
        triggered = false
        src.set(listOf(1))
        assertTrue(!triggered)
        src.set(emptyList())
        assertTrue(triggered)
    }

    @Test
    fun testOnlyTriggerAccessItems() {
        val src = Signal(listOf(1, 2, 3, 4))
        val arr = ComputedArray(src) { item, _ ->
            {
                assertTrue(true)
                item.get() + 1
            }
        }
        Effect {
            arr[0]
            arr[1]
        }
        src.set(listOf(2, 3, 4, 5))
    }
}
