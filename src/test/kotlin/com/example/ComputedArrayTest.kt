package com.example

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull

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
            arr[0]
            triggered = true
        }
        assertEquals(true, triggered)
        triggered = false
        src.set(listOf(2))
        assertEquals(true, triggered)
    }

    @Test
    fun testNotTriggerIfItemValueDidNotChange() {
        val src = Signal(listOf(1))
        val arr = ComputedArray(src) { item, _ -> { item.get() + 1 } }
        var triggered = false
        Effect {
            arr[0]
            triggered = true
        }
        assertEquals(true, triggered)
        triggered = false
        src.set(listOf(1))
        assertEquals(false, triggered)
    }

    @Test
    fun testNotTriggerFirstItemComputedIfSourceItemDidNotChange() {
        val src = Signal(listOf(1))
        val arr = ComputedArray(src) { item, i ->
            {
                if (i == 0) {
                    assertNotNull(item.get())
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
            arr.size
            triggered = true
        }
        assertEquals(true, triggered)
        triggered = false
        src.set(listOf(2))
        assertEquals(false, triggered)
        src.set(listOf(2, 3))
        assertEquals(true, triggered)
    }

    @Test
    fun testWatchItemRemove() {
        val src = Signal(listOf(1, 2))
        val arr = ComputedArray(src) { item, _ -> { item.get() + 1 } }
        var triggered = false
        Effect {
            arr[0]
            triggered = true
        }
        assertEquals(true, triggered)
        triggered = false
        src.set(listOf(1))
        assertEquals(false, triggered)
        src.set(emptyList())
        assertEquals(true, triggered)
    }

    @Test
    fun testOnlyTriggerAccessItems() {
        val src = Signal(listOf(1, 2, 3, 4))
        val arr = ComputedArray(src) { item, _ ->
            {
                assertNotNull(item.get())
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
