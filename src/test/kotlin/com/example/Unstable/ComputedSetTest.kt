package com.example.Unstable

import com.example.Signal
import com.example.Effect
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ComputedSetTest {

    @Test
    fun testGetUpdatedItemValue() {
        val src = Signal(setOf(1))
        val set = ComputedSet(src) { item -> { item.get() + 1 } }
        assertEquals(2, set[1])
    }

    @Test
    fun testWatchItemValueChange() {
        val src = Signal(setOf(1))
        val set = ComputedSet(src) { item -> { item.get() + 1 } }
        var triggered = false
        Effect {
            triggered = true
            set[1]
        }
        assertTrue(triggered)
        triggered = false
        src.set(setOf(2))
        assertTrue(triggered)
    }

    @Test
    fun testNotTriggerIfItemValueDidNotChange() {
        val src = Signal(setOf(1))
        val set = ComputedSet(src) { item -> { item.get() + 1 } }
        var triggered = false
        Effect {
            triggered = true
            set[1]
        }
        assertTrue(triggered)
        triggered = false
        src.set(setOf(1))
        assertTrue(!triggered)
    }

    @Test
    fun testNotTriggerFirstItemComputedIfSourceItemDidNotChange() {
        val src = Signal(setOf(1))
        val set = ComputedSet(src) { item ->
            {
                if (item.get() == 1) {
                    assertTrue(true)
                }
                item.get() + 1
            }
        }
        Effect { set[1] }
        src.set(setOf(1, 2))
        src.set(setOf(2, 2, 3))
    }

    @Test
    fun testWatchSizeChange() {
        val src = Signal(setOf(1))
        val set = ComputedSet(src) { item -> { item.get() + 1 } }
        var triggered = false
        Effect {
            triggered = true
            set.size
        }
        assertTrue(triggered)
        triggered = false
        src.set(setOf(2))
        assertTrue(!triggered)
        src.set(setOf(2, 3))
        assertTrue(triggered)
    }

    @Test
    fun testWatchItemRemove() {
        val src = Signal(setOf(1, 2))
        val set = ComputedSet(src) { item -> { item.get() + 1 } }
        var triggered = false
        Effect {
            triggered = true
            set[1]
        }
        assertTrue(triggered)
        triggered = false
        src.set(setOf(1))
        assertTrue(!triggered)
        src.set(emptySet())
        assertTrue(triggered)
    }

    @Test
    fun testOnlyTriggerAccessItems() {
        val src = Signal(setOf(1, 2, 3, 4))
        val set = ComputedSet(src) { item ->
            {
                assertTrue(true)
                item.get() + 1
            }
        }
        Effect {
            set[1]
            set[2]
        }
        src.set(setOf(2, 3, 4, 5))
    }
}
