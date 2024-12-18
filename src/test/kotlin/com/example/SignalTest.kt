package com.example

import kotlin.test.Test
import kotlin.test.assertEquals

class SignalTest {

    @Test
    fun testSignalGetSet() {
        val signal = Signal(1)
        assertEquals(1, signal.get())
        signal.set(2)
        assertEquals(2, signal.get())
    }

    @Test
    fun testSignalPropagation() {
        val signal = Signal(1)
        var effectTriggered = false

        Effect {
            signal.get()
            effectTriggered = true
        }

        assertEquals(true, effectTriggered)
        effectTriggered = false
        signal.set(2)
        assertEquals(true, effectTriggered)
    }
}
