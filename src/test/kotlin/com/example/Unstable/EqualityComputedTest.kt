package com.example.Unstable

import com.example.Signal
import com.example.Effect
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class EqualityComputedTest {

    @Test
    fun testEqualityComputed() {
        val src = Signal(listOf(1))
        val eqComputed = EqualityComputed { src.get() }
        var triggered = false
        Effect {
            triggered = true
            eqComputed.get()
        }
        assertTrue(triggered)
        triggered = false
        src.set(listOf(1))
        assertTrue(!triggered)
        src.set(listOf(2))
        assertTrue(triggered)
    }

    @Test
    fun testEqualityComputedWithComplexObjects() {
        val src = Signal(mapOf("key" to listOf(1)))
        val eqComputed = EqualityComputed { src.get() }
        var triggered = false
        Effect {
            triggered = true
            eqComputed.get()
        }
        assertTrue(triggered)
        triggered = false
        src.set(mapOf("key" to listOf(1)))
        assertTrue(!triggered)
        src.set(mapOf("key" to listOf(2)))
        assertTrue(triggered)
    }

    @Test
    fun testEqualityComputedWithDifferentTypes() {
        val src = Signal(1)
        val eqComputed = EqualityComputed { src.get() }
        var triggered = false
        Effect {
            triggered = true
            eqComputed.get()
        }
        assertTrue(triggered)
        triggered = false
        src.set(1)
        assertTrue(!triggered)
        src.set(2)
        assertTrue(triggered)
    }
}
